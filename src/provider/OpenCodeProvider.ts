import * as vscode from "vscode";
import { OpenCodeRequestError } from "../errors";
import {
  hasExplicitModelLimits,
  normalizeLiveModelMetadata,
  resolveModelMetadata,
  type CachedModelMetadataSnapshot,
  type ModelMetadataFields,
  type ResolvedModelMetadata,
} from "../models/metadata";

import { thinkingFamily, thinkingProviderFor } from "../thinking";
import { buildOpenCodeGatewayAuthHeaders } from "../openCodeAuth";
import { streamAnthropicMessages as runStreamAnthropicMessages } from "../transports/anthropic";
import { streamChatCompletions as runStreamChatCompletions } from "../transports/chatCompletions";
import { streamGoogleGenerateContent as runStreamGoogleGenerateContent } from "../transports/google";
import { streamResponsesApi as runStreamResponsesApi } from "../transports/responses";

import { resolveBaseVendor, type ProviderVendor } from "../providerTypes";

import { ModelListEntry, OpenCodeModel, ProviderDefinition } from "./definitions";
import {
  buildAnthropicMessagesRequestBody,
  buildChatCompletionsRequestBody,
  buildGoogleGenerateContentBody,
  buildResponsesRequestBody,
} from "../request/builders";
import { buildResponsesToolNameMap } from "../request/openai";

import { runtimeDiagnosticsLines } from "../runtimeDiagnostics";
import { estimateTokenCount } from "../tokenEstimate";
import {
  CAPACITY_LIMITED_MODEL_NOTES,
  CONFIG_SECTION,
  DEFAULT_VISION_PROXY_PROMPT,
  KNOWN_UNAVAILABLE_MODEL_IDS,
  MODEL_LIST_CACHE_KEY_PREFIX,
  MODEL_LIST_CACHE_TTL_MS,
  MODEL_LIST_FETCH_MAX_RETRIES,
  MODEL_LIST_FETCH_RETRY_BASE_MS,
  MODEL_LIST_FETCH_TIMEOUT_MS,
  MODEL_METADATA_REVISION,
  MAX_HISTORY_IMAGES_KEPT,
  HISTORY_TRIM_SAFETY_MARGIN_TOKENS,
  HISTORY_TRIM_TARGET_RATIO,
  RECENT_TRANSPORT_SUMMARY_LIMIT,
  RECENT_TRANSPORT_SUMMARY_STORAGE_PREFIX,
  SETTING_SHOW_PROVIDER_PREFIX,
  SETTING_VISION_PROXY_WHOLE_CONVERSATION,
  TEST_CONNECTION_TIMEOUT_MS,
  VISION_PROXY_MODEL_ID_KEY,
  VISION_PROXY_PROMPT_KEY,
  secretKeyFor,
} from "../config";
import {
  activeProfileFingerprint,
  ensureProfileForApiKey,
  ensureProfileSync,
  refreshGoUsageStatusBar,
  syncTrackerUsage,
  updateUsageStatusBar,
} from "../usage/dashboard";
import { formatCacheHitRatio } from "../usage/usage";
import { estimateCost } from "../usage/pricing";
import { resolveResponseApiKey } from "../apiKeyResolution";
import { clearOpenCodeModelMetadataCache, getOpenCodeModelMetadata } from "../models/metadataFetcher";
import { convertMessage, normalizeMessages, trimOldImagesFromHistoryInPlace } from "./messages";
import { historyByteCapForBudget, trimOldMessagesToFitContext } from "./historyTrim";
import { estimateChatMessageTokenCount } from "./tokens";
import {
  formatModalityBadges,
  getConfiguredApiKey,
  getRequestModelConfiguration,
  getSettings,
  isVisionProxyEnabled,
  modelCapabilities,
  modelConfigurationSchema,
  modelLimits,
  resolveRawModelId,
  shouldHideDeprecatedModel,
} from "./settings";
import { proxyVision } from "./visionProxy";
import { modelPricingFields } from "../models/pricing";
import { buildOpenCodeRequestHeaders, stringifyInitiator } from "../request/headers";
import { getErrorMessage, sleep } from "../utils";

import { clearOpenCodeModelMetadataCache, getOpenCodeModelMetadata } from "../models/metadataFetcher";

import { estimateChatMessageTokenCount } from "./tokens";
import { modelLimits, resolveRawModelId, shouldHideDeprecatedModel } from "./settings";

import { prepareChatRequest, type ChatPrepDeps } from "./chatPrep";
import { provideModelChatInformation, type ModelInfoDeps } from "./modelInfo";
import { ModelListFetcher } from "./modelList";
import { manageProvider, testConnection, type DialogDeps } from "./providerDialogs";
import { TransportSummaryLog } from "./transportLog";
export class OpenCodeProvider implements vscode.LanguageModelChatProvider<OpenCodeModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

  /** Trigger a model information refresh (e.g. after visionModel setting changes). */
  notifyModelInfoChanged(): void {
    this.changeEmitter.fire();
  }
  private readonly apiKeysByModelId = new Map<string, string>();

  /**
   * globalState key tracking whether this vendor has a configured BYOK group
   * (issue #106). Set when a configured-group call is served; read by the
   * groupless call to decide whether to stay silent. Scoped per vendor so an
   * `opencodego` group does not affect `opencodezen`.
   */
  private get byokGroupStateKey(): string {
    return `opencode.byokGroup.v1.${this.definition.vendor}`;
  }

  private hasByokGroupConfigured(): boolean {
    return this.context.globalState.get<boolean>(this.byokGroupStateKey, false);
  }

  private async markByokGroupConfigured(): Promise<void> {
    await this.context.globalState.update(this.byokGroupStateKey, true);
  }
  /** Capped to prevent unbounded growth across long sessions. */
  private readonly reasoningContentByToolCallId = new Map<string, string>();
  private static readonly REASONING_CACHE_LIMIT = 500;
  private readonly liveModelMetadataById = new Map<string, ModelMetadataFields>();
  private outputChannel: vscode.OutputChannel | undefined;

  /**
   * Cached snapshot of the most recent successful model-list fetch for this
   * provider's base vendor. Persisted to globalState so it survives window
   * reloads and can cover transient network failures at startup (issue #78).
   */
  /** Resolves agent-host variants to their base vendor for metadata/routing. */
  private get baseVendor(): ProviderVendor {
    return resolveBaseVendor(this.definition.vendor);
  }

  /** Store reasoning content with a cap to prevent unbounded memory growth. */
  private storeReasoningContent(toolCallIds: string[], reasoningContent: string): void {
    for (const toolCallId of toolCallIds) {
      this.reasoningContentByToolCallId.set(toolCallId, reasoningContent);
    }
    // Evict oldest entries if the cache exceeds the limit.
    if (this.reasoningContentByToolCallId.size > OpenCodeProvider.REASONING_CACHE_LIMIT) {
      const excess = this.reasoningContentByToolCallId.size - OpenCodeProvider.REASONING_CACHE_LIMIT;
      const keys = this.reasoningContentByToolCallId.keys();
      for (let i = 0; i < excess; i++) {
        const key = keys.next().value;
        if (key) this.reasoningContentByToolCallId.delete(key);
      }
    }
  }

  private readonly transportLog: TransportSummaryLog;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly definition: ProviderDefinition,
  ) {
    this.transportLog = new TransportSummaryLog(context, definition.vendor);
    this.transportLog.restore();
  }

  private getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel("OpenCode");
      this.context.subscriptions.push(this.outputChannel);
    }
    return this.outputChannel;
  }

  private log(message: string): void {
    this.getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private async getMetadataSnapshot(): Promise<CachedModelMetadataSnapshot> {
    return getOpenCodeModelMetadata(this.context, this.getOutputChannel());
  }

  private resolveModelMetadata(modelId: string, snapshot: CachedModelMetadataSnapshot): ResolvedModelMetadata {
    return resolveModelMetadata(modelId, this.baseVendor, snapshot, this.liveModelMetadataById);
  }

  private replaceLiveModelMetadata(entries: ModelListEntry[] | undefined): void {
    this.liveModelMetadataById.clear();
    for (const entry of entries ?? []) {
      if (typeof entry.id !== "string" || !entry.id) {
        continue;
      }
      const metadata = normalizeLiveModelMetadata(entry);
      if (metadata) {
        this.liveModelMetadataById.set(entry.id, metadata);
      }
    }
  }

  private async refreshMetadataAndModels(): Promise<void> {
    await clearOpenCodeModelMetadataCache(this.context);
    // Pass the stored API key so the gateway sees the authenticated
    // (per-key) model list, not the anonymous default.
    const apiKey = await this.context.secrets.get(secretKeyFor(this.baseVendor));
    await this.fetchModels(apiKey);
  }

  /**
   * Public entry point for the `OpenCode <Vendor>: Refresh Models` commands.
   *
   * CONTRACT:
   * - Skips the Manage Provider QuickPick and goes straight to a fetch.
   * - Reuses {@link refreshMetadataAndModels}, fires the change emitter so
   *   VS Code re-resolves the picker, and surfaces an informational toast.
   * - On missing API key, points the user at the BYOK flow instead of
   *   prompting for a key (API keys are configured via Manage Language
   *   Models / "+ Add Models" only).
   *
   * Background: this was added after issue #78 revealed that "Refresh Models"
   * was only reachable as a sub-item inside `OpenCode Go: Manage Provider`
   * (and Zen had no manual refresh path at all). The top-level command matches
   * what users naturally type in the Command Palette.
   */
  async refreshModels(): Promise<void> {
    const apiKey = await this.context.secrets.get(secretKeyFor(this.baseVendor));
    if (!apiKey) {
      vscode.window.showErrorMessage(
        `${this.definition.displayName}: No API key configured. Add the provider via Manage Language Models ("+ Add Models" → ${this.definition.displayName}) first.`,
      );
      return;
    }
    await this.refreshMetadataAndModels();
    this.changeEmitter.fire();
    vscode.window.showInformationMessage(`${this.definition.displayName} models refreshed.`);
  }

  async manage(): Promise<void> {
    await manageProvider(this.dialogDeps());
  }

  async testConnection(): Promise<void> {
    await testConnection(this.dialogDeps());
  }

  /** The instance-state view the extracted dialog flows need. */
  private dialogDeps(): DialogDeps {
    return {
      context: this.context,
      baseVendor: this.baseVendor,
      definition: this.definition,
      log: (message) => {
        this.log(message);
      },
      refreshModels: () => this.refreshModels(),
      showDiagnostics: () => this.showDiagnostics(),
    };
  }

  async showDiagnostics(): Promise<void> {
    let models: readonly vscode.LanguageModelChat[] = [];
    let modelSelectionError: string | undefined;
    try {
      models = await vscode.lm.selectChatModels({ vendor: this.definition.vendor });
    } catch (error) {
      modelSelectionError = getErrorMessage(error);
    }

    const hasStoredApiKey = Boolean(await this.context.secrets.get(secretKeyFor(this.baseVendor)));
    const metadataSnapshot = await this.getMetadataSnapshot();
    const lines = models.map((model) => {
      const rawModelId = resolveRawModelId(model.id);
      const metadata = this.resolveModelMetadata(rawModelId, metadataSnapshot);
      const limits = modelLimits(metadata);
      return [
        `- ${rawModelId}`,
        `  rawModelId: ${rawModelId}`,
        `  name: ${model.name}`,
        `  family: ${model.family}`,
        `  vendor: ${model.vendor}`,
        `  version: ${model.version}`,
        `  maxInputTokens: ${String(model.maxInputTokens)}`,
        `  advertisedMaxOutputTokens: ${String(limits.advertisedMaxOutputTokens)}`,
        `  advertisedContextWindow: ${String(limits.advertisedContextWindow)}`,
        `  apiMaxOutputTokens: ${String(limits.maxOutputTokens)}`,
        `  metadataSource: ${metadata.source}`,
        `  supportsVision: ${String(metadata.supportsVision)}`,
        `  status: ${metadata.status ?? "active"}`,
        `  thinkingFamily: ${thinkingFamily(rawModelId) ?? "none"}`,
        `  configurationSchema: ${JSON.stringify((model as unknown as { configurationSchema?: unknown }).configurationSchema ?? null)}`,
        ...(hasExplicitModelLimits(rawModelId, this.baseVendor) ? [] : ["  limits: using bundled fallback"]),
      ].join("\n");
    });

    const content = [
      `# ${this.definition.displayName} Diagnostics`,
      "",
      "## Runtime",
      "",
      ...runtimeDiagnosticsLines(this.context),
      `- credentialInSecretStorage: ${String(hasStoredApiKey)}`,
      `- modelSelectionError: ${modelSelectionError ?? "none"}`,
      "",
      "## Recent Requests",
      "",
      ...this.transportLog.diagnosticLines(),
      `## Models`,
      "",
      `Models visible through vscode.lm.selectChatModels({ vendor: "${this.definition.vendor}" }): ${String(models.length)}`,
      "",
      ...lines,
    ].join("\n");

    const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<OpenCodeModel[]> {
    return provideModelChatInformation(this.modelInfoDeps(), options, token);
  }

  /** The instance-state view {@link provideModelChatInformation} needs. */
  private modelInfoDeps(): ModelInfoDeps {
    return {
      context: this.context,
      baseVendor: this.baseVendor,
      definition: this.definition,
      log: (message) => {
        this.log(message);
      },
      hasByokGroupConfigured: () => this.hasByokGroupConfigured(),
      markByokGroupConfigured: () => this.markByokGroupConfigured(),
      fetchModels: (apiKey, token) => this.fetchModels(apiKey, token),
      getMetadataSnapshot: () => this.getMetadataSnapshot(),
      resolveModelMetadata: (modelId, snapshot) => this.resolveModelMetadata(modelId, snapshot),
      apiKeysByModelId: this.apiKeysByModelId,
    };
  }

  /** The instance-state view {@link prepareChatRequest} needs. */
  private chatPrepDeps(): ChatPrepDeps {
    return {
      context: this.context,
      baseVendor: this.baseVendor,
      definition: this.definition,
      transportLog: this.transportLog,
      log: (message) => {
        this.log(message);
      },
      getMetadataSnapshot: () => this.getMetadataSnapshot(),
      resolveModelMetadata: (modelId, snapshot) => this.resolveModelMetadata(modelId, snapshot),
      reasoningContentByToolCallId: this.reasoningContentByToolCallId,
      apiKeysByModelId: this.apiKeysByModelId,
    };
  }

  async provideLanguageModelChatResponse(
    model: OpenCodeModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const prepared = await prepareChatRequest(this.chatPrepDeps(), model, messages, options, token);
    const {
      apiKey,
      rawModelId,
      apiMessages,
      settings,
      metadata,
      routing,

      limits,

    const rawModelId = model.rawModelId ?? resolveRawModelId(model.id);
    const convertedMessages = await Promise.all(
      messages.map((message) => convertMessage(message, this.reasoningContentByToolCallId, rawModelId)),
    );
    const normalizedImageCount = convertedMessages.map((result) => result.normalizedImageCount).reduce((total, count) => total + count, 0);
    if (normalizedImageCount > 0) {
      this.log(`[vision] Normalized ${String(normalizedImageCount)} image attachment(s) to provider-safe dimensions/encoding.`);
    }

    // Flatten the converted messages, tracking which original message produced
    // each apiMessage. The vision proxy returns per-message descriptions keyed
    // by the original message index, so this mapping lets us apply the correct
    // description to the right apiMessage (convertMessage can emit several
    // messages per input — e.g. tool results — which shifts indices).
    const flatMessages: ApiMessage[] = [];
    const flatSourceIndex: number[] = [];
    for (let i = 0; i < convertedMessages.length; i++) {
      for (const msg of convertedMessages[i].messages) {
        flatMessages.push(msg);
        flatSourceIndex.push(i);
      }
    }

    const baseSettings = getSettings();
    const requestOverride = getRequestModelConfiguration(options);
    // Resolve the effective thinking config: VS Code's per-model configuration
    // (options.modelConfiguration, chatLanguageModels.json) is the SINGLE
    // authority for per-model thinking; the workspace setting is the default;
    // THINKING_DEFAULTS is the final fallback. No extension-side persisted
    // shadow state (removed — it fought the VS Code authority and could pin a
    // stale non-off value over the user's Off).
    const resolvedThinking = resolveThinkingConfig({
      modelId: rawModelId,
      workspace: baseSettings.thinking,
      modelConfiguration: requestOverride,
    });
    const settings: ApiSettings = {
      ...baseSettings,
      thinking: resolvedThinking.settings,
    };
    // Extract the context-size tier selected by the user (if any)
    const contextSizeOverride = typeof requestOverride?.contextSize === "number" ? requestOverride.contextSize : undefined;
    const metadataSnapshot = await this.getMetadataSnapshot();
    const metadata = this.resolveModelMetadata(rawModelId, metadataSnapshot);
    const routing = resolveModelRouting(rawModelId, this.definition);

    // `hasImageInput` is computed from the flattened (pre-normalize) messages:
    // normalization never creates or drops image parts, so this matches the
    // previous `messagesHaveImages(apiMessages)` result.
    const hasImageInput = messagesHaveImages(flatMessages);
    const actuallySupportsVision = metadata.supportsVision; // cached before capabilities override

    // Vision proxy: when a text-only model receives images, relay them
    // through a configured vision-capable Copilot model, then replace
    // the image parts with the text description. Descriptions are cached
    // per image (`imageDescriptionCache`), so already-described images are
    // reused on future turns without calling the vision model again.
    const visionProxyModelId = isVisionProxyEnabled() ? this.context.globalState.get<string>(VISION_PROXY_MODEL_ID_KEY, "") || "" : "";
    if (hasImageInput && !actuallySupportsVision && visionProxyModelId) {
      const visionProxyPrompt = this.context.globalState.get<string>(VISION_PROXY_PROMPT_KEY, "") || DEFAULT_VISION_PROXY_PROMPT;
      // When `opencodego.visionProxyWholeConversation` is on, describe the whole
      // conversation instead of only the message with a new image, so descriptions
      // keep conversation context (at the cost of more tokens).
      const describeWholeConversation = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<boolean>(SETTING_VISION_PROXY_WHOLE_CONVERSATION, false);
      let imagesHandled = false;
      try {
        this.log(`[vision-proxy] Forwarding images to ${visionProxyModelId}${describeWholeConversation ? " (whole conversation)" : ""}`);
        const { descriptions, cacheHits, cacheMisses } = await proxyVision(
          messages,
          visionProxyModelId,
          visionProxyPrompt,
          describeWholeConversation,
          token,
        );
        if (descriptions.size > 0) {
          const fallbackDescription = descriptions.values().next().value ?? "";
          for (let i = 0; i < flatMessages.length; i++) {
            const msg = flatMessages[i];
            if (!Array.isArray(msg.content)) continue;
            if (!msg.content.some((p) => p.type === "image_url")) continue;
            const textParts = msg.content
              .filter((p): p is OpenAiContentPart & { text: string } => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text);
            // Tool-result images are not described by the proxy, so they fall
            // back to the first available description (matching the previous
            // single-description behavior).
            const description = descriptions.get(flatSourceIndex[i]) ?? fallbackDescription;
            msg.content = [{ type: "text", text: `[Image described by vision proxy]: ${description}` }];
            if (textParts.length > 0) {
              msg.content.push({ type: "text", text: textParts.join("\n") });
            }
            imagesHandled = true;
          }
          this.log(
            `[vision-proxy] Replaced images using vision proxy model (${String(cacheHits)} from cache, ${String(cacheMisses)} newly described)`,
          );
        }
      } catch (err) {
        this.log(`[vision-proxy] Error: ${getErrorMessage(err)}`);
      }

      // If the proxy didn't handle the images (error, empty response, or
      // model not found), strip them anyway so the non-vision model
      // doesn't receive image data it can't process (fixes 400 errors).
      if (!imagesHandled) {
        for (const msg of flatMessages) {
          if (!Array.isArray(msg.content)) continue;
          if (msg.content.some((p) => p.type === "image_url")) {
            const textParts = msg.content
              .filter((p): p is OpenAiContentPart & { text: string } => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text);
            msg.content = [{ type: "text", text: "[Image unavailable — vision proxy unavailable]" }];
            if (textParts.length > 0) {
              msg.content.push({ type: "text", text: textParts.join("\n") });
            }
          }
        }
        this.log(`[vision-proxy] Stripped images (proxy unavailable), prevented 400`);
      }
    }

    const apiMessages = normalizeMessages(flatMessages);

    // Trim old images from conversation history to bound cumulative payload
    // weight. MCP screenshot loops (chrome-devtools-mcp, playwright-mcp) can
    // accumulate multi-MB base64 data URIs in history and trigger upstream
    // `400 Upstream request failed` rejections from OpenCode Go (issue #38
    // follow-up, documented in docs/issues/34 line 264+). Only the most recent
    // MAX_HISTORY_IMAGES_KEPT images are kept; older ones are replaced with a
    // short placeholder text note so the model retains conversation structure
    // without incurring the payload cost.
    //
    // Applied AFTER vision proxy so proxy-replaced text descriptions (already
    // small) are preserved, and applied BEFORE promptTokens estimation so the
    // output budget reflects the trimmed payload.
    const trimmedCount = trimOldImagesFromHistoryInPlace(apiMessages);
    if (trimmedCount > 0) {
      this.log(
        `[history-trim] Replaced ${String(trimmedCount)} old image(s) with placeholder text to bound payload (kept most recent ${String(MAX_HISTORY_IMAGES_KEPT)}).`,
      );
    }

    // Bound the text conversation history to the model's input context window.
    // Long multi-turn conversations (or repeated turns without Compact
    // Conversation) can exceed the context limit, causing the upstream to reject
    // the oversized request (HTTP 400/503) or return an empty stream — surfaced
    // by VS Code as "No response came" / "Sorry, no response was returned" — and
    // a huge payload also makes the upstream hang (10-minute request timeout)
    // and slows the extension session. Drop the oldest messages (preserving the
    // anchor and the current prompt, never splitting a tool-call group) until
    // the payload fits BOTH the input token budget AND a hard byte ceiling.
    const effectiveContextWindow = contextSizeOverride ?? metadata.contextWindow;
    const outputReserve = Math.min(metadata.maxOutputTokens, effectiveContextWindow);
    // Stay safely below the window: the upstream rejects near the full limit
    // (the reporter saw failures at ~70% context), so cap at a target ratio and
    // also leave room for the output reserve + a fixed safety margin.
    const ratioBudget = Math.floor(effectiveContextWindow * HISTORY_TRIM_TARGET_RATIO);
    const maxBudget = Math.max(1, effectiveContextWindow - outputReserve - HISTORY_TRIM_SAFETY_MARGIN_TOKENS);
    const inputBudget = Math.min(ratioBudget, maxBudget);
    const historyMaxBytes = historyByteCapForBudget(inputBudget);
    const historyTrim = trimOldMessagesToFitContext(apiMessages, inputBudget, historyMaxBytes, options.tools);
    if (historyTrim.removed > 0) {
      this.log(
        `[history-trim] Dropped ${String(historyTrim.removed)} old message(s) to fit context window (budget=${String(inputBudget)} tokens, maxBytes=${String(historyMaxBytes)}); estimated payload now ~${String(historyTrim.finalTokens)} tokens / ${String(historyTrim.finalBytes)} bytes.`,
      );
    }

    // Use the estimate computed during trimming (no second full re-estimation)
    // so the output budget reflects the payload that is actually sent upstream.
    const promptTokens = historyTrim.finalTokens;
    const limits = modelLimits(metadata, settings, contextSizeOverride, promptTokens);

    const thinkingPayload = thinkingProviderFor(rawModelId).buildPayload(settings.thinking, {
      hasImageInput: hasImageInput && metadata.supportsVision,
      endpoint: routing.endpointKind === "messages" ? "messages" : routing.endpointKind === "responses" ? "responses" : "chat",
    });
    const requestHeaders = buildOpenCodeRequestHeaders(messages, options, rawModelId);
    const outputChannel = this.getOutputChannel();
    const onTransportSummary = (summary: TransportRequestSummary) => {
      // Compute credits for VS Code session cost (1 credit = $0.01).
      // VS Code reads usage.copilotCredits from the LanguageModelDataPart
      // to accumulate session cost. We mutate the summary object directly
      // so emitSummary includes it in the usage data parts.
      // Use the same estimateCost() helper as goUsageTracker.record() to
      // guarantee cost and credits stay in sync.
      const prompt = summary.promptTokens ?? 0;
      const completion = summary.completionTokens ?? 0;
      const cached = summary.cachedTokens ?? 0;
      const cost = estimateCost(summary.modelId, prompt, completion, cached, metadata.cost);
      summary.copilotCredits = cost * 100;

      this.recordTransportSummary(summary, routing.endpointKind, metadata.source, options.requestInitiator);
      updateUsageStatusBar(this.definition.displayName, rawModelId, summary);
      if (this.baseVendor === GO_VENDOR) {
        const tracker = ensureProfileForApiKey(apiKey);
        this.log(
          `[go-usage] Recording profile=${activeProfileFingerprint}: model=${summary.modelId} promptTokens=${prompt} completionTokens=${completion} cachedTokens=${cached}`,
        );
        tracker.record(summary, metadata.cost);
        refreshGoUsageStatusBar();
        this.log(`[go-usage] After record profile=${activeProfileFingerprint}: entries=${tracker.getSummary().today.requests}`);
        // Re-sync the server-accurate account meters (TTL-guarded, uses the
        // exact key this request ran under — covers BYOK group keys too).
        void syncTrackerUsage(tracker, apiKey);
      }
    };

    this.log(
      `Request: initiator=${options.requestInitiator} model=${model.id} rawModel=${rawModelId} endpoint=${routing.endpointKind} metadataSource=${metadata.source} messages=${String(apiMessages.length)} promptEstimate=${String(promptTokens)} maxOutputTokens=${String(limits.maxOutputTokens)} session=${requestHeaders["x-opencode-session"]} request=${requestHeaders["x-opencode-request"]} modelConfiguration=${JSON.stringify(extractThinkingOverride(requestOverride))} thinkingSource=${resolvedThinking.source} thinking=${JSON.stringify(settings.thinking)} thinkingPayload=${JSON.stringify(thinkingPayload)}`,
    );
    if (settings.debugReasoning) {
      this.log("Reasoning debug is enabled. Provider reasoning_content will be written to this output channel when available.");
    }

    try {
      const contextWindowOutputBuffer = limits.advertisedMaxOutputTokens;
      // Subagent/tool-call requests always have tools present. Force
      // think-tag stripping for these requests to prevent <think> tags
      // in content from rendering as blank code blocks in the chat UI.
      const isToolCallRequest = Array.isArray(options.tools) && options.tools.length > 0;
      const forceStripThinkTags = isToolCallRequest || undefined;

      if (routing.endpointKind === "messages") {
        await runStreamAnthropicMessages({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildAnthropicMessagesRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          authHeaders: buildOpenCodeGatewayAuthHeaders("messages", apiKey),
          capacityLimitedModelNotes: CAPACITY_LIMITED_MODEL_NOTES,
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
          forceStripThinkTags,
        });
        return;
      }

      if (routing.endpointKind === "responses") {
        await runStreamResponsesApi({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildResponsesRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
          authHeaders: buildOpenCodeGatewayAuthHeaders("responses", apiKey),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          capacityLimitedModelNotes: CAPACITY_LIMITED_MODEL_NOTES,
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
          forceStripThinkTags,
          toolNameMap: buildResponsesToolNameMap(options.tools, rawModelId),
          onReasoningContent: (toolCallIds, reasoningContent) => {
            this.storeReasoningContent(toolCallIds, reasoningContent);
          },
        });
        this.log(`Request completed: model=${model.id}`);
        return;
      }

      if (routing.endpointKind === "google") {
        await runStreamGoogleGenerateContent({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildGoogleGenerateContentBody(apiMessages, options, settings, limits),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          authHeaders: buildOpenCodeGatewayAuthHeaders("google", apiKey),
          capacityLimitedModelNotes: CAPACITY_LIMITED_MODEL_NOTES,
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
          forceStripThinkTags,
          onReasoningContent: (toolCallIds, reasoningContent) => {
            this.storeReasoningContent(toolCallIds, reasoningContent);
          },
        });
        this.log(`Request completed: model=${model.id}`);
        return;
      }

      await runStreamChatCompletions({
        url: routing.endpointUrl,
        providerDisplayName: this.definition.displayName,
        apiKey,
        modelId: rawModelId,
        body: buildChatCompletionsRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
        authHeaders: buildOpenCodeGatewayAuthHeaders("chat-completions", apiKey),
        requestHeaders,
        progress,
        token,
        output: outputChannel,
        debugReasoning: settings.debugReasoning,
        requestTimeoutMs: settings.requestTimeoutMs,
        streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
        contextWindowOutputBuffer,
        capacityLimitedModelNotes: CAPACITY_LIMITED_MODEL_NOTES,
        onTransportSummary,
        stripThinkTags: settings.stripThinkTags,
        forceStripThinkTags,
        treatReasoningAsContent: thinkingProviderFor(rawModelId).treatReasoningAsContent(routing.endpointUrl, settings.thinking),
        onReasoningContent: (toolCallIds, reasoningContent) => {
          this.storeReasoningContent(toolCallIds, reasoningContent);
        },
      });
      this.log(`Request completed: model=${model.id}`);
    } catch (error) {
      const message = getErrorMessage(error);
      this.log(`ERROR model=${model.id}: ${message}`);
      if (error instanceof OpenCodeRequestError) {
        vscode.window.showErrorMessage(error.userMessage);
      }
      throw error;
    }
  }

  provideTokenCount(
    _model: OpenCodeModel,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return Promise.resolve(typeof text === "string" ? estimateTokenCount(text) : estimateChatMessageTokenCount(text));
  }

  /**
   * Fetch the live model list from the OpenCode gateway.
   *
   * CONTRACT:
   * - Resilient to transient network failures (DNS, TCP reset, connect
   *   timeout, 5xx, 429): retries up to {@link MODEL_LIST_FETCH_MAX_RETRIES}
   *   times with exponential backoff. See {@link isTransientFetchError}.
   * - Hard timeout of {@link MODEL_LIST_FETCH_TIMEOUT_MS} per attempt —
   *   undici's default 300s `headersTimeout` is far too long for the picker
   *   (issue #78: picker appeared stuck for minutes on hung TCP).
   * - Sends `User-Agent` ({@link getUserAgent}) so strict gateways don't
   *   silently drop the request.
   * - On final failure, prefers the last successful snapshot (cached in
   *   globalState, TTL {@link MODEL_LIST_CACHE_TTL_MS}) over the bundled
   *   `fallbackModels`, so transient failures don't make the picker "flash
   *   then disappear" when VS Code 1.129's agent host re-resolves frequently.
   * - Respects the VS Code CancellationToken: bails early on abort, never
   *   retries an aborted request.
   */
  private modelListFetcher: ModelListFetcher | undefined;

  /** Lazy — created on first use so `baseVendor` is available. */
  private get fetcher(): ModelListFetcher {
    if (!this.modelListFetcher) {
      this.modelListFetcher = new ModelListFetcher({
        context: this.context,
        definition: this.definition,
        log: (message) => {
          this.log(message);
        },
        replaceLiveModelMetadata: (models) => {
          this.replaceLiveModelMetadata(models);
        },
        filterAvailableModels: (ids) => this.filterAvailableModels(ids),
      });
    }
    return this.modelListFetcher;
  }

  private async fetchModels(apiKey?: string, token?: vscode.CancellationToken): Promise<string[]> {
    return this.fetcher.fetch(apiKey, token);
  }

  private async filterAvailableModels(modelIds: string[]): Promise<string[]> {
    const uniqueModelIds = [...new Set(modelIds)];

    try {
      const metadataSnapshot = await this.getMetadataSnapshot();
      const filteredModelIds = uniqueModelIds.filter(
        (modelId) =>
          !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId) &&
          !shouldHideDeprecatedModel(modelId, this.baseVendor, metadataSnapshot) &&
          (this.definition.filterModel?.(modelId) ?? true),
      );

      const removedModelIds = uniqueModelIds.filter((modelId) => !filteredModelIds.includes(modelId));
      if (removedModelIds.length) {
        this.log(`Filtered unavailable/deprecated models: ${removedModelIds.join(", ")}`);
      }

      return filteredModelIds;
    } catch (error) {
      const message = getErrorMessage(error);
      this.log(`Could not fetch model status metadata from models.dev. Applying local unavailable model filter only. ${message}`);
      return uniqueModelIds.filter(
        (modelId) => !KNOWN_UNAVAILABLE_MODEL_IDS.has(modelId) && (this.definition.filterModel?.(modelId) ?? true),
      );
    }
  }
}

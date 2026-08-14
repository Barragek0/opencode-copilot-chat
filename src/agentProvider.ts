/** Build an agent-host variant while preserving the base provider endpoints. */
export function providerVariant<T extends { vendor: string; displayName: string }, AgentVendor extends string, BaseVendor extends string>(
  base: T,
  agentVendor: AgentVendor,
  displayName: string,
  baseVendor: BaseVendor,
): Omit<T, "vendor" | "displayName"> & {
  vendor: AgentVendor;
  displayName: string;
  isAgentVariant: true;
  baseVendor: BaseVendor;
} {
  return {
    ...base,
    vendor: agentVendor,
    displayName,
    isAgentVariant: true,
    baseVendor,
  };
}

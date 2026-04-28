/**
 * Interface for sending transactions to the connected client and awaiting the result.
 *
 * In public mode, the server injects a real implementation that serializes the tx
 * over WebSocket, waits for the user to sign, and resolves with the signature.
 * Throws an error if the user rejects or a timeout/disconnect occurs.
 *
 * In autonomous mode, this is never called (tools sign and submit directly).
 */
export interface TransactionSender {
  /**
   * Send a transaction to the connected client, wait for user approval and signing,
   * and resolve with the confirmed signature.
   * Throws if rejected, timed out, or the client disconnected.
   */
  sendAndAwait(
    transactionBase64: string,
    options?: {
      message?: string;
      index?: number;
      total?: number;
      feeSol?: number;
    },
  ): Promise<string>;
}

/**
 * Context passed to tools during execution.
 * Provides access to the wallet address and transaction sender.
 */
export interface AgentContext {
  walletAddress: string | null;
  transactionSender: TransactionSender | null;
  agentMode: 'public' | 'autonomous';
  agentAssetAddress: string | null;
  agentTokenMint: string | null;
  agentFeeSol: number;
  tokenOverride: string | null;
  ownerWallet: string | null;
  /** Time Machine: per-session character context. Set when serving /chat/:slug. */
  character?: TimeMachineCharacterContext | null;
}

/**
 * Subset of CharacterRow that tools running inside a Time Machine chat
 * session need. Kept small so we don't accidentally leak the full system
 * prompt or DB internals through a tool result.
 */
export interface TimeMachineCharacterContext {
  id: string;
  slug: string;
  canonicalName: string;
  genesisTokenMint: string;
  genesisTicker: string;
  ownerWallet: string;
}

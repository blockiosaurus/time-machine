import {
  registerIdentityV1,
  type RegisterIdentityV1InstructionAccounts,
} from '@metaplex-foundation/mpl-agent-registry';
import {
  publicKey as toPublicKey,
  type Umi,
  type PublicKey,
  type TransactionBuilder,
} from '@metaplex-foundation/umi';

export const EIP_8004_REGISTRATION_TYPE =
  'https://eips.ethereum.org/EIPS/eip-8004#registration-v1';

export interface AgentRegistrationServiceEntry {
  type: 'chat' | 'web' | string;
  endpoint: string;
}

export interface AgentRegistrationDoc {
  /** Always EIP_8004_REGISTRATION_TYPE for v1. */
  type: string;
  /** Display name (canonical name of the historical figure). */
  name: string;
  /** Short bio summary. */
  description: string;
  /** Irys gateway URL of the portrait image. */
  image: string;
  /** Service endpoints. Time Machine always exposes a "chat" entry. */
  services?: AgentRegistrationServiceEntry[];
  /** Whether the agent is currently active. */
  active?: boolean;
}

/**
 * Build the JSON document that gets pinned to Irys before calling
 * `registerIdentityV1`. The pinned URI is what gets recorded on-chain.
 */
export function buildAgentRegistrationDoc(input: {
  canonicalName: string;
  bioSummary: string;
  portraitUri: string;
  chatEndpoint: string;
}): AgentRegistrationDoc {
  return {
    type: EIP_8004_REGISTRATION_TYPE,
    name: input.canonicalName,
    description: input.bioSummary,
    image: input.portraitUri,
    services: [
      {
        type: 'chat',
        endpoint: input.chatEndpoint,
      },
    ],
    active: true,
  };
}

export interface RegisterIdentityArgs {
  /** The MPL Core asset address (the character NFT). */
  asset: PublicKey | string;
  /** The Time Machine collection address. */
  collection: PublicKey | string;
  /** The Irys URI of the registration document. */
  agentRegistrationUri: string;
  /** Optional override for the asset authority signer. */
  authority?: RegisterIdentityV1InstructionAccounts['authority'];
}

/**
 * Build a TransactionBuilder for `registerIdentityV1`. Caller is responsible
 * for signing/submitting (in Time Machine, this is bundled into the user's
 * mint transaction so the user signs once).
 */
export function buildRegisterIdentityTx(
  umi: Umi,
  args: RegisterIdentityArgs,
): TransactionBuilder {
  return registerIdentityV1(umi, {
    asset: toPublicKey(args.asset),
    collection: toPublicKey(args.collection),
    agentRegistrationUri: args.agentRegistrationUri,
    authority: args.authority,
  });
}

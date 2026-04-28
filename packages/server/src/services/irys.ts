import { createGenericFile, type Umi } from '@metaplex-foundation/umi';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { createUmi, getConfig } from '@metaplex-agent/shared';

export interface IrysUpload {
  /** Irys tx id (also serves as content identifier). */
  cid: string;
  /** Public gateway URL — `https://gateway.irys.xyz/<cid>`. */
  uri: string;
  /** Same as cid; Irys uses the tx id as the canonical reference. */
  txId: string;
}

const IRYS_DEVNET = 'https://devnet.irys.xyz';
const IRYS_MAINNET = 'https://node1.irys.xyz';

/**
 * Pick the Irys node URL based on the SOLANA_RPC_URL the agent is using:
 *   - any URL containing "devnet" or "testnet" -> devnet Irys (free uploads)
 *   - everything else (mainnet RPCs from Helius/QuickNode/Triton/etc.)
 *     -> mainnet Irys (paid in SOL from AGENT_KEYPAIR)
 */
function pickIrysAddress(solanaRpcUrl: string): string {
  const lower = solanaRpcUrl.toLowerCase();
  if (lower.includes('devnet') || lower.includes('testnet')) return IRYS_DEVNET;
  return IRYS_MAINNET;
}

let _umi: Umi | null = null;

/**
 * Build a Umi instance with the Irys uploader plugin attached. The agent
 * keypair (AGENT_KEYPAIR) pays for uploads, so it must be funded with SOL
 * on the matching network.
 */
function getUmi(): Umi {
  if (_umi) return _umi;
  const config = getConfig();
  const address = pickIrysAddress(config.SOLANA_RPC_URL);
  _umi = createUmi().use(irysUploader({ address }));
  return _umi;
}

/** Pin a JSON document. Returns the Irys tx id + gateway URI. */
export async function pinJson(doc: unknown): Promise<IrysUpload> {
  const umi = getUmi();
  const file = createGenericFile(JSON.stringify(doc), 'document.json', {
    contentType: 'application/json',
  });
  const [uri] = await umi.uploader.upload([file]);
  return uriToUpload(uri);
}

/** Pin raw bytes (typically an image). */
export async function pinBytes(
  bytes: Uint8Array,
  contentType: string,
  filename: string = 'asset.bin',
): Promise<IrysUpload> {
  const umi = getUmi();
  const file = createGenericFile(bytes, filename, { contentType });
  const [uri] = await umi.uploader.upload([file]);
  return uriToUpload(uri);
}

/**
 * The Umi uploader returns a fully-qualified gateway URL like
 * `https://gateway.irys.xyz/<txid>`. Extract the txid + normalize.
 */
function uriToUpload(uri: string | undefined): IrysUpload {
  if (!uri) throw new Error('Irys uploader returned no URI');
  const match = /\/([A-Za-z0-9_-]{20,})$/.exec(uri);
  const txId = match?.[1] ?? uri.split('/').pop() ?? '';
  return { cid: txId, txId, uri };
}

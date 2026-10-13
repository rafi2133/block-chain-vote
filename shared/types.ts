import type { JsonFragment } from 'ethers';
export interface Deployment {
  deploymentId: string; chainId: number; contractAddress: string; admin: string;
  deploymentBlock: number; deploymentBlockHash: string; runtimeCodeHash: string;
  abi: JsonFragment[]; deployedAt: string;
  deploymentTransactionHash?: string;
  tokenAddress: string; tokenAbi: JsonFragment[]; tokenRuntimeCodeHash: string;
  tokenSymbol: string; tokenDecimals: number; voteCost: string;
}
export interface Metadata {
  title: string; description: string; candidates: { name: string; description: string }[];
  draftId?: string; schemaVersion?: number;
}
export type ElectionState = 'Draft' | 'Scheduled' | 'Active' | 'Ended';
export interface ElectionView {
  id: number; creator: string; startsAt: number; endsAt: number; candidateCount: number;
  metadataHash: string; published: boolean; eligibleVoterCount: number; totalVotes: number;
  counts: number[]; state: ElectionState; metadata: Metadata | null; rawMetadata: string | null;
  verified: boolean; blockNumber: number; blockTimestamp: number;
}
export interface AppConfig extends Deployment {
  demoEnabled: boolean; rpcPath: string; demoAccounts: { address: string; label: string; index: number }[];
}
export interface VoterBinding { personId: string; address: string }
export interface PreparedDraft {
  id: string; rawMetadata: string; metadataHash: string; candidateCount: number;
  startsAt: number; endsAt: number; wallets: string[];
}

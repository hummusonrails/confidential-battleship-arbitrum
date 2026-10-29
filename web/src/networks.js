import { arbitrumSepolia, sepolia } from 'viem/chains';
import { chains as cofheChains } from '@cofhe/sdk/chains';

export const NETWORKS = {
  'arbitrum-sepolia': {
    label: 'Arbitrum Sepolia',
    chain: arbitrumSepolia,
    cofhe: cofheChains.arbSepolia,
    rpc: 'https://sepolia-rollup.arbitrum.io/rpc',
    rpcEnv: 'ARB_SEPOLIA_RPC',
    explorer: 'https://sepolia.arbiscan.io',
    faucet: 'https://www.alchemy.com/faucets/arbitrum-sepolia',
  },
  'ethereum-sepolia': {
    label: 'Ethereum Sepolia',
    chain: sepolia,
    cofhe: cofheChains.sepolia,
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    rpcEnv: 'ETH_SEPOLIA_RPC',
    explorer: 'https://sepolia.etherscan.io',
    faucet: 'https://www.alchemy.com/faucets/ethereum-sepolia',
  },
};

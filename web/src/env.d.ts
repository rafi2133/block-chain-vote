/// <reference types="vite/client" />
import type { MetaMaskProvider } from './metamask';
declare global {
  interface Window {
    ethereum?: MetaMaskProvider;
  }
}

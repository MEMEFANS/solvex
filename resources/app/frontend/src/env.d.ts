/// <reference types="vite/client" />
import type { WalletConfig, WalletState } from './types';
declare global {
  interface Window {
    WG_REACT_APP?: boolean; WG_OPERATOR_MODE?: boolean;
    currentWalletConnection?: { address: string } | null;
    currentWalletProfile?: { authenticated?: boolean; address?: string } | null;
    getWalletStateRevision?: () => number;
    solvexRuntimeReady: Promise<void>;
    switchTab: (page: string) => Promise<boolean | undefined>;
    openTradePage: (product?: string, symbol?: string) => Promise<void>;
    openStockPage: () => Promise<void>;
    handleWalletButton: (button?: HTMLElement) => void;
    ensurePlatformSession: () => Promise<unknown>;
    disconnectWallet: () => Promise<void>;
    loadPageFeature: (name: string) => Promise<void>;
    earnSwitch?: (name: string) => void;
    LegacyEarn?: { show: (name: string) => void; deactivate?: () => void };
    ReferralRewards?: { load: (context: { isCurrent: () => boolean }) => Promise<void>; reset: () => void };
    Portal?: { invalidate: () => void; load: (page: string, force?: boolean) => Promise<void>; register: (name: string, page: { load?: () => void; reset?: () => void }) => void };
    copyTextSmart?: (value: string) => Promise<boolean>;
    __solvexTestWallet?: (wallet: WalletState) => void;
    solvexWalletBridge?: {
      provider: () => { request: (args: { method: string; params?: unknown }) => Promise<unknown> } | null;
      config: () => WalletConfig | null;
      address: () => string;
      ensureSession: (trigger?: HTMLElement | null) => Promise<unknown>;
      loadConfig: () => Promise<WalletConfig>;
      deposit: (networkId: string, amount: string, onStatus?: (text: string) => void) => Promise<string>;
      depositErrorMessage: (error: unknown) => string;
    };
    USDTWithdrawal?: { open: () => void; close: () => void };
    ATokenWithdrawal?: { open: () => Promise<void> };
  }
}

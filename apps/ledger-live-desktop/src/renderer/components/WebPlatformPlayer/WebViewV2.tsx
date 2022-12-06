import { shell, WebviewTag } from "electron";
import * as remote from "@electron/remote";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";

import { UserRefusedOnDevice } from "@ledgerhq/errors";
import { Account, AccountLike, SignedOperation, Operation } from "@ledgerhq/types-live";
import { CryptoCurrency } from "@ledgerhq/types-cryptoassets";
import { getAccountBridge } from "@ledgerhq/live-common/bridge/index";
import { getEnv } from "@ledgerhq/live-common/env";
import {
  findCryptoCurrencyById,
  listSupportedCurrencies,
} from "@ledgerhq/live-common/currencies/index";
import {
  flattenAccounts,
  addPendingOperation,
  getMainAccount,
} from "@ledgerhq/live-common/account/index";
import { MessageData } from "@ledgerhq/live-common/hw/signMessage/types";
import { useToasts } from "@ledgerhq/live-common/notifications/ToastProvider/index";
import { TypedMessageData } from "@ledgerhq/live-common/families/ethereum/types";
import {
  useWalletAPIAccounts,
  useWalletAPICurrencies,
  useWalletAPIUrl,
} from "@ledgerhq/live-common/wallet-api/react";
import { AppManifest } from "@ledgerhq/live-common/wallet-api/types";
import { RpcError, Transport } from "@ledgerhq/wallet-api-core";
import {
  broadcastTransactionLogic,
  receiveOnAccountLogic,
  signTransactionLogic,
  signMessageLogic,
} from "@ledgerhq/live-common/wallet-api/logic";
import { accountToWalletAPIAccount } from "@ledgerhq/live-common/wallet-api/converters";
import { firstValueFrom, WalletAPIServer } from "@ledgerhq/wallet-api-server/lib/index";
import trackingWrapper from "@ledgerhq/live-common/wallet-api/tracking";
import { CURRENCY_NOT_FOUND } from "@ledgerhq/wallet-api-server/lib/errors";

import { openModal } from "../../actions/modals";
import { updateAccountWithUpdater } from "../../actions/accounts";
import TrackPage from "../../analytics/TrackPage";
import useTheme from "../../hooks/useTheme";
import { accountsSelector } from "../../reducers/accounts";
import BigSpinner from "../BigSpinner";
import { setDrawer } from "~/renderer/drawers/Provider";
import { OperationDetails } from "~/renderer/drawers/OperationDetails";
import SelectAccountAndCurrencyDrawer from "~/renderer/drawers/DataSelector/SelectAccountAndCurrencyDrawer";
import { track } from "~/renderer/analytics/segment";
import TopBar from "./TopBar";
import { TopBarConfig } from "./type";
import { Container, Wrapper, CustomWebview, Loader } from "./styled";

const tracking = trackingWrapper(track);

type WebPlatformPlayerConfig = {
  topBarConfig?: TopBarConfig;
};

type Props = {
  manifest: AppManifest;
  onClose?: () => void;
  inputs?: Record<string, string>;
  config?: WebPlatformPlayerConfig;
};

export function WebView({ manifest, onClose, inputs = {}, config }: Props) {
  const theme = useTheme("colors.palette");

  const targetRef: { current: null | WebviewTag } = useRef(null);
  const dispatch = useDispatch();
  const accounts = flattenAccounts(useSelector(accountsSelector));
  const { pushToast } = useToasts();
  const { t } = useTranslation();

  const [widgetLoaded, setWidgetLoaded] = useState(false);

  const url = useWalletAPIUrl(
    manifest,
    {
      background: theme.background.paper,
      text: theme.text.shade100,
    },
    inputs,
  );

  const walletAPIAccounts = useWalletAPIAccounts(accounts);
  const walletAPICurrencies = useWalletAPICurrencies();

  const serverRef = useRef<WalletAPIServer>();
  const transportRef = useRef<Transport>();

  useEffect(() => {
    if (targetRef.current) {
      transportRef.current = {
        onMessage: undefined,
        send: message => {
          const webview = targetRef.current;
          if (webview) {
            const origin = new URL(webview.src).origin;
            webview.contentWindow.postMessage(message, origin);
          }
        },
      };
      serverRef.current = new WalletAPIServer(transportRef.current);
      serverRef.current.setPermissions({
        currencyIds: manifest.currencies === "*" ? ["*"] : manifest.currencies,
        methodIds: [
          "account.request",
          "account.list",
          "account.receive",
          "currency.list",
          "message.sign",
          "transaction.sign",
          "transaction.signAndBroadcast",
          "wallet.capabilities",
        ],
      });
      serverRef.current.setAccounts(walletAPIAccounts);
      serverRef.current.setCurrencies(walletAPICurrencies);

      serverRef.current.setHandler("account.request", async ({ accounts$, currencies$ }) => {
        tracking.requestAccountRequested(manifest);
        const currencies = await firstValueFrom(currencies$);

        return new Promise((resolve, reject) => {
          // handle no curencies selected case
          const cryptoCurrencyIds = currencies.map(({ id }) => id);

          let currencyList: CryptoCurrency[] = [];
          // if single currency available redirect to select account directly
          if (cryptoCurrencyIds.length === 1) {
            const currency = findCryptoCurrencyById(cryptoCurrencyIds[0]);
            if (currency) {
              currencyList = [currency];
            }

            if (!currencyList[0]) {
              tracking.requestAccountFail(manifest);
              // @TODO replace with correct error
              reject(new RpcError(CURRENCY_NOT_FOUND));
            }
          } else {
            currencyList = listSupportedCurrencies().filter(({ id }) =>
              cryptoCurrencyIds.includes(id),
            );
          }

          setDrawer(
            SelectAccountAndCurrencyDrawer,
            {
              currencies: cryptoCurrencyIds,
              onAccountSelected: (account: Account, parentAccount: Account | undefined) => {
                setDrawer();
                tracking.requestAccountSuccess(manifest);
                resolve(accountToWalletAPIAccount(account, parentAccount));
              },
              accounts$,
            },
            {
              onRequestClose: () => {
                setDrawer();
                tracking.requestAccountFail(manifest);
                reject(new Error("Canceled by user"));
              },
            },
          );
        });
      });

      serverRef.current.setHandler("account.receive", ({ account }) => {
        return receiveOnAccountLogic(
          { manifest, accounts, tracking },
          account.id,
          (account, parentAccount, accountAddress) =>
            new Promise((resolve, reject) => {
              dispatch(
                openModal("MODAL_EXCHANGE_CRYPTO_DEVICE", {
                  account,
                  parentAccount,
                  onResult: () => {
                    tracking.receiveSuccess(manifest);
                    resolve(accountAddress);
                  },
                  onCancel: (error: Error) => {
                    tracking.receiveFail(manifest);
                    reject(error);
                  },
                  verifyAddress: true,
                }),
              );
            }),
        );
      });

      serverRef.current.setHandler("message.sign", ({ account, message }) => {
        return signMessageLogic(
          { manifest, accounts, tracking },
          account.id,
          message.toString("hex"),
          (account: AccountLike, message: MessageData | TypedMessageData) =>
            new Promise((resolve, reject) => {
              dispatch(
                openModal("MODAL_SIGN_MESSAGE", {
                  message,
                  account,
                  onConfirmationHandler: (signature: string) => {
                    tracking.signMessageSuccess(manifest);
                    resolve(Buffer.from(signature));
                  },
                  onFailHandler: (err: Error) => {
                    tracking.signMessageFail(manifest);
                    reject(err);
                  },
                  onClose: () => {
                    tracking.signMessageUserRefused(manifest);
                    reject(UserRefusedOnDevice());
                  },
                }),
              );
            }),
        );
      });

      serverRef.current.setHandler(
        "transaction.sign",
        async ({ account, transaction, options }) => {
          const signedOperation = await signTransactionLogic(
            { manifest, accounts, tracking },
            account.id,
            transaction,
            (account, parentAccount, { canEditFees, hasFeesProvided, liveTx }) => {
              return new Promise<SignedOperation>((resolve, reject) => {
                dispatch(
                  openModal("MODAL_SIGN_TRANSACTION", {
                    canEditFees,
                    stepId: canEditFees && !hasFeesProvided ? "amount" : "summary",
                    transactionData: liveTx,
                    useApp: options?.hwAppId,
                    account,
                    parentAccount,
                    onResult: (signedOperation: SignedOperation) => {
                      tracking.signTransactionSuccess(manifest);
                      resolve(signedOperation);
                    },
                    onCancel: (error: Error) => {
                      tracking.signTransactionFail(manifest);
                      reject(error);
                    },
                  }),
                );
              });
            },
          );

          return Buffer.from(signedOperation.signature);
        },
      );

      serverRef.current.setHandler(
        "transaction.signAndBroadcast",
        async ({ account, transaction, options }) => {
          // TODO try to avoid duplicated signTransactionLogic & UI code
          const signedTransaction = await signTransactionLogic(
            { manifest, accounts, tracking },
            account.id,
            transaction,
            (account, parentAccount, { canEditFees, hasFeesProvided, liveTx }) => {
              return new Promise((resolve, reject) => {
                dispatch(
                  openModal("MODAL_SIGN_TRANSACTION", {
                    canEditFees,
                    stepId: canEditFees && !hasFeesProvided ? "amount" : "summary",
                    transactionData: liveTx,
                    useApp: options?.hwAppId,
                    account,
                    parentAccount,
                    onResult: (signedOperation: SignedOperation) => {
                      tracking.signTransactionSuccess(manifest);
                      resolve(signedOperation);
                    },
                    onCancel: (error: Error) => {
                      tracking.signTransactionFail(manifest);
                      reject(error);
                    },
                  }),
                );
              });
            },
          );

          return broadcastTransactionLogic(
            { manifest, accounts, tracking },
            account.id,
            signedTransaction,
            async (account, parentAccount, signedOperation) => {
              const bridge = getAccountBridge(account, parentAccount);
              const mainAccount = getMainAccount(account, parentAccount);

              let optimisticOperation: Operation = signedOperation.operation;

              if (!getEnv("DISABLE_TRANSACTION_BROADCAST")) {
                try {
                  optimisticOperation = await bridge.broadcast({
                    account: mainAccount,
                    signedOperation,
                  });
                  tracking.broadcastSuccess(manifest);
                } catch (error) {
                  tracking.broadcastFail(manifest);
                  throw error;
                }
              }

              dispatch(
                updateAccountWithUpdater(mainAccount.id, account =>
                  addPendingOperation(account, optimisticOperation),
                ),
              );

              pushToast({
                id: optimisticOperation.id,
                type: "operation",
                title: t("platform.flows.broadcast.toast.title"),
                text: t("platform.flows.broadcast.toast.text"),
                icon: "info",
                callback: () => {
                  tracking.broadcastOperationDetailsClick(manifest);
                  setDrawer(OperationDetails, {
                    operationId: optimisticOperation.id,
                    accountId: account.id,
                    parentId: parentAccount?.id,
                  });
                },
              });

              return optimisticOperation.hash;
            },
          );
        },
      );
    }
    // Only used to init the server, no update needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    serverRef.current?.setAccounts(walletAPIAccounts);
  }, [walletAPIAccounts]);

  useEffect(() => {
    serverRef.current?.setCurrencies(walletAPICurrencies);
  }, [walletAPICurrencies]);

  const handleMessage = useCallback(event => {
    if (event.channel === "webviewToParent") {
      transportRef.current?.onMessage?.(event.args[0]);
    }
  }, []);

  const handleLoad = useCallback(() => {
    tracking.loadSuccess(manifest);
    setWidgetLoaded(true);
  }, [manifest]);

  const handleReload = useCallback(() => {
    const webview = targetRef.current;
    if (webview) {
      tracking.reload(manifest);
      setWidgetLoaded(false);
      webview.reloadIgnoringCache();
    }
  }, [manifest]);

  useEffect(() => {
    tracking.load(manifest);
    const webview = targetRef.current;
    if (webview) {
      webview.addEventListener("ipc-message", handleMessage);
    }

    return () => {
      if (webview) {
        webview.removeEventListener("ipc-message", handleMessage);
      }
    };
  }, [manifest, handleMessage]);

  const handleNewWindow = useCallback(async e => {
    const protocol = new URL(e.url).protocol;
    if (protocol === "http:" || protocol === "https:") {
      await shell.openExternal(e.url);
    }
  }, []);

  useEffect(() => {
    const webview = targetRef.current;

    if (webview) {
      // For mysterious reasons, the webpreferences attribute does not
      // pass through the styled component when added in the JSX.
      webview.webpreferences = "nativeWindowOpen=no";
      webview.addEventListener("new-window", handleNewWindow);
      webview.addEventListener("did-finish-load", handleLoad);
    }

    return () => {
      if (webview) {
        webview.removeEventListener("new-window", handleNewWindow);
        webview.removeEventListener("did-finish-load", handleLoad);
      }
    };
  }, [handleLoad, handleNewWindow]);

  return (
    <Container>
      <TrackPage category="Platform" name="App" appId={manifest.id} params={inputs} />
      <TopBar
        manifest={manifest}
        onReload={handleReload}
        onClose={onClose}
        webviewRef={targetRef}
        config={config?.topBarConfig}
      />

      <Wrapper>
        <CustomWebview
          src={url.toString()}
          ref={targetRef}
          style={{ opacity: widgetLoaded ? 1 : 0 }}
          preload={`file://${remote.app.dirname}/webviewPreloader.bundle.js`}
        />
        {!widgetLoaded ? (
          <Loader>
            <BigSpinner size={50} />
          </Loader>
        ) : null}
      </Wrapper>
    </Container>
  );
}

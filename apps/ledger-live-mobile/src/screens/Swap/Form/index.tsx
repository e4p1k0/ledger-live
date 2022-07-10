import React, { useMemo, useState, useEffect, useCallback } from "react";
import Config from "react-native-config";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { checkQuote } from "@ledgerhq/live-common/lib/exchange/swap";
import { Button, Flex } from "@ledgerhq/native-ui";
import {
  ExchangeRate,
  KYCStatus,
  ValidCheckQuoteErrorCodes,
  OnNoRatesCallback,
  ActionRequired,
} from "@ledgerhq/live-common/lib/exchange/swap/types";
import {
  usePollKYCStatus,
  useSwapTransaction,
  useProviders,
  useSelectableCurrencies,
} from "@ledgerhq/live-common/lib/exchange/swap/hooks";
import {
  getKYCStatusFromCheckQuoteStatus,
  KYC_STATUS,
  shouldShowKYCBanner,
  shouldShowLoginBanner,
} from "@ledgerhq/live-common/lib/exchange/swap/utils";
import { useDispatch, useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { shallowAccountsSelector } from "../../../reducers/accounts";
import { swapKYCSelector } from "../../../reducers/settings";
import { setSwapKYCStatus } from "../../../actions/settings";
// eslint-disable-next-line import/named
import { TrackScreen, track } from "../../../analytics";
import { Loading } from "./Loading";
import { NotAvailable } from "./NotAvailable";
import { TxForm } from "./TxForm";
import { Summary } from "./Summary";
import { Requirement } from "./Requirement";
import { trackSwapError, SWAP_VERSION } from "../utils";
import { SwapFormProps } from "../types";
import { Max } from "./Max";
import { Modal } from "./Modal";

export const ratesExpirationThreshold = 60000;

export function SwapForm({ route: { params } }: SwapFormProps) {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const accounts = useSelector(shallowAccountsSelector);
  const { providers, error, pairs } = useProviders(
    Config.SWAP_DISABLED_PROVIDERS,
  );

  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | undefined>();
  const swapTx = useSwapTransaction({
    accounts,
    setExchangeRate,
    onNoRates: trackNoRates,
  });

  const exchangeRatesState = swapTx.swap?.rates;
  const swapKYC = useSelector(swapKYCSelector);

  const currencyNames = useMemo(() => {
    if (!swapTx.swap.from.currency) {
      return pairs.map(p => p.to);
    }

    return pairs.reduce<string[]>(
      (acc, p) =>
        p.from === swapTx.swap.from.currency?.id ? [...acc, p.to] : acc,
      [],
    );
  }, [pairs, swapTx.swap.from.currency]);

  const currencies = useSelectableCurrencies({
    allCurrencies: [...new Set(currencyNames)],
  });

  const { provider, kyc } = useMemo<{
    provider?: string;
    kyc?: KYCStatus;
  }>(() => {
    const provider = exchangeRate?.provider;

    if (!provider || !swapKYC) {
      return { exchangeRate, provider };
    }

    return {
      provider,
      exchangeRate,
      kyc: swapKYC[provider],
    };
  }, [exchangeRate, swapKYC]);

  const [currentFlow, setCurrentFlow] = useState<ActionRequired>(
    ActionRequired.None,
  );
  const [currentBanner, setCurrentBanner] = useState<ActionRequired>(
    ActionRequired.None,
  );
  const [errorCode, setErrorCode] = useState<
    ValidCheckQuoteErrorCodes | undefined
  >();

  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (params?.currency) {
      swapTx.setToCurrency(params.currency);
    }

    if (params?.accountId) {
      const account = accounts.find(a => a.id === params?.accountId);
      swapTx.setFromAccount(account);
    }

    if (params?.rate) {
      setExchangeRate(params.rate);
    }

    if (params?.transaction) {
      swapTx.setTransaction(params.transaction);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // On provider change, reset banner and flow
  useEffect(() => {
    setCurrentFlow(ActionRequired.None);
    setCurrentBanner(ActionRequired.None);
    setErrorCode(undefined);
  }, [provider]);

  useEffect(() => {
    // In case of error, don't show  login, kyc or mfa banner
    if (error) {
      // Don't show any flow banner on error to avoid double banner display
      setCurrentBanner(ActionRequired.None);
      return;
    }

    // Don't display login nor kyc banner if user needs to complete MFA
    if (currentBanner === ActionRequired.MFA) {
      return;
    }

    if (shouldShowLoginBanner({ provider, token: kyc?.id })) {
      setCurrentBanner(ActionRequired.Login);
      return;
    }

    if (!kyc) {
      return;
    }

    // we display the KYC banner component if partner requiers KYC and is not yet approved
    // we don't display it if user needs to login first
    if (
      currentBanner !== ActionRequired.Login &&
      shouldShowKYCBanner({ provider, validKycStatus: kyc.status })
    ) {
      setCurrentBanner(ActionRequired.KYC);
    }
  }, [error, provider, kyc, currentBanner]);

  useEffect(() => {
    // Whenever an account is added, reselect the currency to pick a default target account.
    // (possibly the one that got created)
    if (swapTx.swap.to.currency && !swapTx.swap.to.account) {
      swapTx.setToCurrency(swapTx.swap.to.currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // FIXME: update usePollKYCStatus to use checkQuote for KYC status (?)
  usePollKYCStatus(
    {
      provider,
      kyc,
      onChange: res => {
        if (!provider) return;
        dispatch(
          setSwapKYCStatus({
            provider,
            id: res?.id,
            status: res?.status,
          }),
        );
      },
    },
    [dispatch],
  );
  const swapError = swapTx.fromAmountError || exchangeRatesState?.error;

  // Track errors
  useEffect(
    () => {
      swapError &&
        trackSwapError(swapError, {
          sourcecurrency: swapTx.swap.from.currency?.name,
          provider,
          swapVersion: SWAP_VERSION,
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [swapError],
  );

  // close login widget once we get a bearer token (i.e: the user is logged in)
  useEffect(() => {
    if (kyc?.id && currentFlow === ActionRequired.Login) {
      setCurrentFlow(ActionRequired.None);
    }
  }, [kyc?.id, currentFlow]);

  useEffect(() => {
    if (
      !kyc?.id ||
      !exchangeRate?.rateId ||
      currentFlow === ActionRequired.KYC ||
      currentFlow === ActionRequired.MFA
    ) {
      return;
    }
    handleCheckQuote();

    async function handleCheckQuote() {
      if (!provider || !exchangeRate?.rateId || !kyc) {
        return;
      }

      const status = await checkQuote({
        provider,
        quoteId: exchangeRate.rateId,
        bearerToken: kyc.id,
      });

      // User needs to complete MFA on partner own UI / dedicated widget
      if (status.codeName === "MFA_REQUIRED") {
        setCurrentBanner(ActionRequired.MFA);
        return;
      }
      // No need to show MFA banner for other cases
      setCurrentBanner(ActionRequired.None);

      if (typeof provider === "undefined") {
        return;
      }

      if (status.codeName === "RATE_VALID") {
        // If trade can be done and KYC already approved, we are good
        // PS: this can't be checked before the `checkQuote` call since a KYC status can become expierd
        if (kyc.status === KYC_STATUS.approved) {
          return;
        }

        // If status is ok, close login, kyc and mfa widgets even if open
        setCurrentBanner(ActionRequired.None);

        dispatch(
          setSwapKYCStatus({
            provider,
            id: kyc.id,
            status: KYC_STATUS.approved,
          }),
        );
        return;
      }

      // Handle all KYC related errors
      if (status.codeName.startsWith("KYC_")) {
        const updatedKycStatus = getKYCStatusFromCheckQuoteStatus(status);
        if (!updatedKycStatus) return;

        if (updatedKycStatus !== kyc.status) {
          dispatch(
            setSwapKYCStatus({
              provider,
              id: kyc.id,
              status: updatedKycStatus,
            }),
          );
        }
        return;
      }

      // If user is unauthenticated, reset login and KYC state
      if (status.codeName === "UNAUTHENTICATED_USER") {
        dispatch(
          setSwapKYCStatus({
            provider,
            id: undefined,
            status: undefined,
          }),
        );
        return;
      }

      // All other statuses are considered errors
      setErrorCode(status.codeName);
    }
  }, [kyc, exchangeRate, dispatch, provider, currentFlow]);

  const isSwapReady =
    !errorCode &&
    !swapTx.bridgePending &&
    exchangeRatesState.status !== "loading" &&
    swapTx.transaction &&
    !error &&
    !swapError &&
    currentBanner === ActionRequired.None &&
    exchangeRate &&
    swapTx.swap.to.account;

  const onSubmit = useCallback(() => {
    track("Page Swap Form - Request", {
      sourceCurrency: swapTx.swap.from.currency?.name,
      targetCurrency: swapTx.swap.to.currency?.name,
      provider,
      swapVersion: SWAP_VERSION,
    });
    setConfirmed(true);
  }, [swapTx, provider]);

  const onCloseModal = useCallback(() => {
    setConfirmed(false);
  }, []);

  if (providers) {
    return (
      // @ts-ignore-error
      <KeyboardAwareScrollView>
        <Flex flex={1} justifyContent="space-between" padding={6}>
          <Flex flex={1}>
            <TrackScreen category="Swap Form" providerName={provider} />
            <TxForm
              swapTx={swapTx}
              provider={provider}
              accounts={accounts}
              currencies={currencies}
              exchangeRate={exchangeRate}
            />

            {swapTx.swap.rates.status === "loading" ? (
              <Flex height={200}>
                <Loading size={20} />
              </Flex>
            ) : (
              <>
                <Summary
                  provider={provider}
                  swapTx={swapTx}
                  exchangeRate={exchangeRate}
                  kyc={kyc}
                />

                <Requirement required={currentBanner} provider={provider} />
              </>
            )}
          </Flex>

          <Flex paddingY={4}>
            <Max swapTx={swapTx} />

            <Button type="main" disabled={!isSwapReady} onPress={onSubmit}>
              {t("common.exchange")}
            </Button>
          </Flex>
        </Flex>

        <Modal
          swapTx={swapTx}
          provider={provider}
          confirmed={confirmed}
          onClose={onCloseModal}
        />
      </KeyboardAwareScrollView>
    );
  }

  if (error) {
    return <NotAvailable />;
  }

  return <Loading />;
}

const trackNoRates: OnNoRatesCallback = ({ toState }) => {
  track("Page Swap Form - Error No Rate", {
    sourceCurrency: toState.currency?.name,
  });
};

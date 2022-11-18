import { Page, Locator } from "@playwright/test";

export class DiscoverPage {
  readonly page: Page;
  readonly discoverTitle: Locator;
  readonly discoverMenuButton: Locator;
  readonly testAppCatalogItem: Locator;
  readonly disclaimerTitle: Locator;
  readonly disclaimerText: Locator;
  readonly getAllAccountsButton: Locator;
  readonly requestAccountButton: Locator;
  readonly selectAssetTitle: Locator;
  readonly selectAssetSearchBar: Locator;
  readonly selectAccountTitle: Locator;
  readonly selectBtcAsset: Locator;
  readonly selectBtcAccount: Locator;
  readonly disclaimerCheckbox: Locator;
  readonly signContinueButton: Locator;
  readonly confirmText: Locator;

  constructor(page: Page) {
    this.page = page;
    this.discoverMenuButton = page.locator("data-test-id=drawer-catalog-button");
    this.discoverTitle = page.locator("data-test-id=discover-title");
    this.testAppCatalogItem = page.locator("#platform-catalog-app-dummy-live-app");
    this.disclaimerTitle = page.locator("data-test-id=live-app-disclaimer-drawer-title");
    this.disclaimerText = page.locator("text=External Application");
    this.getAllAccountsButton = page.locator("data-test-id=get-all-accounts-button"); // TODO: make this into its own model
    this.requestAccountButton = page.locator("data-test-id=request-single-account-button");
    this.selectAssetTitle = page.locator("data-test-id=select-asset-drawer-title");
    this.selectAssetSearchBar = page.locator("data-test-id=select-asset-drawer-search-input");
    this.selectAccountTitle = page.locator("data-test-id=select-account-drawer-title");
    this.selectBtcAsset = page.locator("text=Bitcoin").first();
    this.selectBtcAccount = page.locator("text=Bitcoin 1 (legacy)").first();
    this.disclaimerCheckbox = page.locator("data-test-id=dismiss-disclaimer");
    this.signContinueButton = page.locator("text=Continue");
    this.confirmText = page.locator(
      "text=Please confirm the operation on your device to finalize it",
    );
  }

  async openTestApp() {
    await this.testAppCatalogItem.click();
    await this.disclaimerTitle.waitFor({ state: "visible" });
  }

  async getAccountsList() {
    await this.clickWebviewElement("[data-test-id=get-all-accounts-button]");
  }

  async requestAsset() {
    await this.clickWebviewElement("[data-test-id=request-single-account-button]");
    await this.selectAssetTitle.isVisible();
    await this.selectAssetSearchBar.isEnabled();
  }

  async selectAsset() {
    await this.selectBtcAsset.click();
  }

  async selectAccount() {
    await this.selectAccountTitle.isVisible();
    // TODO: make this dynamic with passed in variable
    await this.selectBtcAccount.click();
  }

  async verifyAddress() {
    await this.clickWebviewElement("[data-test-id=verify-address-button]");
  }

  async listCurrencies() {
    await this.clickWebviewElement("[data-test-id=list-currencies-button]");
  }

  async signTransaction() {
    await this.clickWebviewElement("[data-test-id=sign-transaction-button]");
  }

  async continueToSignTransaction() {
    await this.signContinueButton.click({ force: true });
  }

  async waitForConfirmationScreenToBeDisplayed() {
    await this.confirmText.waitFor({ state: "visible" });
  }

  async clickWebviewElement(elementName: string) {
    await this.page.evaluate(elementName => {
      const webview = document.querySelector("webview");
      (webview as any).executeJavaScript(
        `(function() {
        const element = document.querySelector('${elementName}');
        element.click();
      })();
    `,
      );
    }, elementName);
  }

  delay(timeout: number) {
    return new Promise(resolve => setTimeout(() => resolve("delay complete"), timeout));
  }
}

// ==UserScript==
// @name         AliExpress Helpers
// @namespace    https://www.aliexpress.com/
// @version      0.2.3
// @description  Add copy buttons, CAD conversion, and per-unit cost helper on AliExpress.
// @match        https://www.aliexpress.com/p/order/index.html*
// @match        https://www.aliexpress.com/p/shoppingcart/index.html*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  'use strict';

  const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
  const RATE_REFRESH_MS = 10 * 60 * 1000;
  const CONTAINER_SELECTOR = '.order-item-content-opt-price';
  const TOTAL_SELECTOR = '[data-pl="order_item_content_price_total"]';
  const COPY_BUTTON_CLASS = 'ae-helper-copy-btn';
  const CAD_ROW_CLASS = 'ae-helper-cad-row';
  const CART_PAGE_PATH = '/p/shoppingcart/index.html';
  const CART_ESTIMATED_TOTAL_LABEL = 'estimated total';
  const CART_SUMMARY_ITEM_SELECTOR = '.cart-summary-item-wrapStyle';
  const CART_SUMMARY_LABEL_SELECTOR = '.cart-summary-item-wrapStyle-label';
  const CART_SUMMARY_CONTENT_SELECTOR = '.cart-summary-item-wrapStyle-content';
  const CART_CHOSEN_ITEM_SELECTOR = '.cart-summary-chosenCartLines-item';
  const CART_PRODUCT_SELECTOR = '.cart-product';
  const CART_PRODUCT_IMAGE_SELECTOR = '.cart-product-img';
  const CART_QUANTITY_INPUT_SELECTOR = '.comet-v2-input-number-input[aria-label="number"]';
  const PER_UNIT_ROW_CLASS = 'ae-helper-per-unit-row';
  const PER_UNIT_LABEL_CLASS = 'ae-helper-per-unit-label';
  const PER_UNIT_VALUE_CLASS = 'ae-helper-per-unit-value';
  const PER_UNIT_MESSAGE_CLASS = 'ae-helper-per-unit-message';
  const CART_BADGE_CLASS = 'ae-helper-badge';
  const LOG_PREFIX = '[AE Helpers]';

  let cadRate = null;
  let lastRateFetch = 0;
  let lastRateError = null;
  let scanScheduled = false;
  let cartUpdateTimer = null;
  const processedContainers = new WeakSet();

  const logDebug = (...args) => {
    console.debug(LOG_PREFIX, ...args);
  };

  const addStyles = () => {
    const css = `
      ${CONTAINER_SELECTOR} { align-items: center; }
      .${COPY_BUTTON_CLASS} {
        background: #0f172a;
        border: 1px solid #0f172a;
        color: #f8fafc;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        margin-right: 8px;
        padding: 6px 10px;
        position: relative;
        border-radius: 8px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
        transition: transform 150ms ease, background 150ms ease, opacity 150ms ease, box-shadow 150ms ease;
      }
      .${COPY_BUTTON_CLASS}:hover {
        background: #1e293b;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.2);
      }
      .${COPY_BUTTON_CLASS}:focus-visible {
        outline: 2px solid rgba(59, 130, 246, 0.6);
        outline-offset: 2px;
      }
      .${COPY_BUTTON_CLASS}.copied {
        background: #16a34a;
        border-color: #16a34a;
        transform: translateY(-1px);
      }
      .${COPY_BUTTON_CLASS}.copied::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 10px;
        box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.18);
        opacity: 0;
        animation: ae-helper-pulse 450ms ease;
      }
      .${CAD_ROW_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        padding: 6px 10px;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        font-size: 12px;
        color: #0f172a;
      }
      .${CAD_ROW_CLASS} .${COPY_BUTTON_CLASS} { margin-right: 0; }
      .ae-helper-cad-label {
        color: #0f172a;
        font-weight: 600;
      }
      .ae-helper-cad-value {
        color: #0f172a;
        font-weight: 700;
      }
      .${PER_UNIT_ROW_CLASS} {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 8px;
        width: 100%;
        box-sizing: border-box;
        align-self: stretch;
        flex: 0 0 auto;
        padding: 8px 12px;
        border-radius: 12px;
        border: 1px dashed #cbd5f5;
        background: #eef2ff;
        font-size: 13px;
        color: #1e1b4b;
        gap: 12px;
      }
      .${PER_UNIT_LABEL_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        color: #1e1b4b;
      }
      .${PER_UNIT_VALUE_CLASS} {
        font-weight: 700;
        color: #0f172a;
      }
      .${PER_UNIT_MESSAGE_CLASS} {
        color: #475569;
        font-weight: 500;
      }
      .${CART_BADGE_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        border-radius: 999px;
        background: #0f172a;
        color: #f8fafc;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      @keyframes ae-helper-pulse {
        0% { opacity: 1; transform: scale(0.95); }
        100% { opacity: 0; transform: scale(1.15); }
      }
    `;

    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
    } else {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
    }
  };

  const copyText = (text) => {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
      return;
    }

    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  };

  const parseUsd = (text) => {
    const match = text.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };

  const parseCurrencyAmount = (text) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const match = normalized.match(/(-?[\d,.]+)/);
    if (!match) return null;
    const amount = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(amount)) return null;
    const currency = normalized.replace(match[1], '').replace(/\s+/g, ' ').trim();
    return { amount, currency };
  };

  const extractBackgroundImageUrl = (element) => {
    if (!element) return null;
    const style = element.style?.backgroundImage || '';
    const match = style.match(/url\(["']?(.*?)["']?\)/i);
    return match ? match[1] : null;
  };

  const formatCad = (value) => `CA $${value.toFixed(2)}`;

  const getUsdText = (totalNode) => {
    const priceNode = totalNode.querySelector('div');
    return (priceNode?.textContent || totalNode.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const getCartSummaryUsdText = (contentNode) => {
    if (!contentNode) return '';
    const text = contentNode.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
  };

  const ensureRate = async () => {
    const now = Date.now();
    if (cadRate && now - lastRateFetch < RATE_REFRESH_MS) return cadRate;

    try {
      logDebug('Fetching FX rate...', RATE_URL);
      const response = await fetch(RATE_URL, { credentials: 'omit' });
      logDebug('FX response status:', response.status);
      const data = await response.json();
      logDebug('FX response payload:', data);
      if (data && data.rates && typeof data.rates.CAD === 'number') {
        cadRate = data.rates.CAD;
        lastRateFetch = now;
        lastRateError = null;
        logDebug('FX rate updated:', cadRate);
      } else {
        lastRateError = 'CAD rate missing in response';
        logDebug('FX rate missing in response.');
      }
    } catch (error) {
      lastRateError = error;
      logDebug('FX rate fetch failed:', error);
      return cadRate;
    }

    return cadRate;
  };

  const updateCadRow = async (container, totalNode) => {
    const rate = await ensureRate();
    if (!rate) {
      logDebug('No FX rate available yet.', { lastRateError });
      return;
    }

    const usdText = getUsdText(totalNode);
    const usdValue = parseUsd(usdText);
    if (usdValue === null) {
      logDebug('Unable to parse USD value from text:', usdText);
      return;
    }

    const cadAmount = (usdValue * rate).toFixed(2);
    const cadValue = formatCad(Number(cadAmount));
    const host = container.closest('.order-item-content-opt') || container.parentElement;
    if (!host) return;
    let cadRow = host.querySelector(`:scope > .${CAD_ROW_CLASS}`);

    if (!cadRow) {
      logDebug('Injecting CAD row.');
      cadRow = document.createElement('div');
      cadRow.className = CAD_ROW_CLASS;

      const cadCopy = document.createElement('button');
      cadCopy.type = 'button';
      cadCopy.className = COPY_BUTTON_CLASS;
      cadCopy.textContent = 'Copy';
      cadCopy.addEventListener('click', () => handleCopy(cadCopy, cadValueNode.dataset.value || cadAmount));

      const cadLabel = document.createElement('span');
      cadLabel.className = 'ae-helper-cad-label';
      cadLabel.textContent = 'CAD Total';

      const cadValueNode = document.createElement('span');
      cadValueNode.className = 'ae-helper-cad-value';
      cadValueNode.dataset.value = cadAmount;

      const badge = document.createElement('span');
      badge.className = CART_BADGE_CLASS;
      badge.textContent = 'AE Helper';

      cadRow.append(badge, cadLabel, cadValueNode, cadCopy);
      host.insertBefore(cadRow, host.querySelector('.order-item-btns-wrap') || null);
    }

    const cadValueNode = cadRow.querySelector('.ae-helper-cad-value');
    if (cadValueNode) {
      cadValueNode.textContent = cadValue;
      cadValueNode.dataset.value = cadAmount;
    }
  };

  const enhanceTotal = (container) => {
    const totalNode = container.querySelector(TOTAL_SELECTOR);
    if (!totalNode) return;

    if (!processedContainers.has(container)) {
      processedContainers.add(container);
      logDebug('Injecting USD copy button.');
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = COPY_BUTTON_CLASS;
      copyButton.textContent = 'Copy';
      copyButton.addEventListener('click', () => {
        const usdText = getUsdText(totalNode);
        const usdValue = usdText ? parseUsd(usdText) : null;
        if (usdValue !== null) handleCopy(copyButton, usdValue.toString());
      });

      totalNode.parentElement?.insertBefore(copyButton, totalNode);
    }

    updateCadRow(container, totalNode);
  };

  const scan = () => {
    logDebug('Scanning totals...');
    document.querySelectorAll(CONTAINER_SELECTOR).forEach(enhanceTotal);
  };

  const scheduleScan = () => {
    if (scanScheduled) return;
    scanScheduled = true;
    window.requestAnimationFrame(() => {
      scanScheduled = false;
      scan();
    });
  };

  const handleCopy = (button, text) => {
    if (!text) return;
    copyText(text);
    logDebug('Copied value:', text);
    const original = button.textContent;
    button.textContent = 'Copied';
    button.classList.add('copied');
    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove('copied');
    }, 1200);
  };

  const observe = () => {
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const isCartPage = () => window.location.pathname.includes(CART_PAGE_PATH);

  const findEstimatedTotalRow = () => {
    const labels = document.querySelectorAll(CART_SUMMARY_LABEL_SELECTOR);
    for (const label of labels) {
      const text = label.textContent?.trim().toLowerCase() || '';
      if (text === CART_ESTIMATED_TOTAL_LABEL) {
        return label.closest(CART_SUMMARY_ITEM_SELECTOR);
      }
    }
    return null;
  };

  const ensurePerUnitRow = () => {
    const estimatedRow = findEstimatedTotalRow();
    if (!estimatedRow) return null;
    let row = estimatedRow.nextElementSibling;
    if (!row || !row.classList.contains(PER_UNIT_ROW_CLASS)) {
      row = document.createElement('div');
      row.className = PER_UNIT_ROW_CLASS;

      const badge = document.createElement('span');
      badge.className = CART_BADGE_CLASS;
      badge.textContent = 'AE Helper';

      const label = document.createElement('div');
      label.className = PER_UNIT_LABEL_CLASS;
      label.textContent = 'Per-unit cost';
      label.append(badge);

      const content = document.createElement('div');
      content.className = 'ae-helper-per-unit-content';

      const value = document.createElement('span');
      value.className = PER_UNIT_VALUE_CLASS;

      const message = document.createElement('span');
      message.className = PER_UNIT_MESSAGE_CLASS;

      content.append(value, message);
      row.append(label, content);
      estimatedRow.insertAdjacentElement('afterend', row);
    }
    return row;
  };

  const resolveSelectedProduct = (selectedItem) => {
    if (!selectedItem) return null;
    const targetImageUrl = extractBackgroundImageUrl(
      selectedItem.querySelector('.cart-summary-chosenCartLines-item-img')
    );
    const products = Array.from(document.querySelectorAll(CART_PRODUCT_SELECTOR));
    if (targetImageUrl) {
      const matched = products.find((product) => {
        const imageNode = product.querySelector(CART_PRODUCT_IMAGE_SELECTOR);
        return extractBackgroundImageUrl(imageNode) === targetImageUrl;
      });
      if (matched) return matched;
    }
    return null;
  };

  const removeLegacyCartBadges = () => {
    document.querySelectorAll('.ae-helper-cart-cad-total').forEach((node) => node.remove());
  };

  const updatePerUnitRow = () => {
    removeLegacyCartBadges();
    const row = ensurePerUnitRow();
    if (!row) return;

    const valueNode = row.querySelector(`.${PER_UNIT_VALUE_CLASS}`);
    const messageNode = row.querySelector(`.${PER_UNIT_MESSAGE_CLASS}`);
    if (!valueNode || !messageNode) return;

    const estimatedRow = findEstimatedTotalRow();
    const estimatedContent = estimatedRow?.querySelector(CART_SUMMARY_CONTENT_SELECTOR);
    const estimatedText = getCartSummaryUsdText(estimatedContent);
    const parsed = parseCurrencyAmount(estimatedText);

    if (!parsed) {
      row.hidden = true;
      return;
    }

    const selectedItems = Array.from(document.querySelectorAll(CART_CHOSEN_ITEM_SELECTOR));
    if (selectedItems.length !== 1) {
      valueNode.textContent = '';
      valueNode.style.display = 'none';
      messageNode.style.display = 'inline';
      messageNode.textContent = 'Select exactly one item to calculate per-unit cost.';
      row.hidden = false;
      return;
    }

    const product = resolveSelectedProduct(selectedItems[0]);
    const quantityInput = product?.querySelector(CART_QUANTITY_INPUT_SELECTOR);
    const quantity = quantityInput ? Number(quantityInput.value.replace(/,/g, '')) : NaN;

    if (!Number.isFinite(quantity) || quantity <= 0) {
      row.hidden = true;
      return;
    }

    const perUnitUsd = parsed.amount / quantity;
    if (!Number.isFinite(perUnitUsd)) {
      row.hidden = true;
      return;
    }

    valueNode.textContent = `${parsed.currency || ''}${perUnitUsd.toFixed(2)}`;
    valueNode.style.display = 'inline';
    messageNode.style.display = 'none';
    row.hidden = false;
  };

  const scheduleCartUpdate = () => {
    if (cartUpdateTimer) window.clearTimeout(cartUpdateTimer);
    cartUpdateTimer = window.setTimeout(() => {
      cartUpdateTimer = null;
      updatePerUnitRow();
    }, 150);
  };

  const observeCart = () => {
    const observer = new MutationObserver(scheduleCartUpdate);
    observer.observe(document.body, { childList: true, subtree: true });

    document.addEventListener(
      'input',
      (event) => {
        if (event.target?.matches(CART_QUANTITY_INPUT_SELECTOR)) {
          scheduleCartUpdate();
        }
      },
      true
    );

    document.addEventListener(
      'click',
      (event) => {
        if (event.target?.closest(CART_PRODUCT_SELECTOR)) {
          scheduleCartUpdate();
        }
      },
      true
    );
  };

  const init = () => {
    addStyles();
    const isCart = isCartPage();
    if (isCart) {
      scheduleCartUpdate();
      observeCart();
    } else {
      scheduleScan();
      observe();
    }
    setInterval(() => {
      cadRate = null;
      if (isCart) {
        scheduleCartUpdate();
      } else {
        scheduleScan();
      }
    }, RATE_REFRESH_MS);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

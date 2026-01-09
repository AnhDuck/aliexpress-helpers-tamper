// ==UserScript==
// @name         AliExpress Helpers
// @namespace    https://www.aliexpress.com/
// @version      0.1.0
// @description  Add copy buttons and CAD conversion on order list totals.
// @match        https://www.aliexpress.com/p/order/index.html*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// ==/UserScript==

(() => {
  'use strict';

  const RATE_URL = 'https://api.exchangerate.host/latest?base=USD&symbols=CAD';
  const RATE_REFRESH_MS = 10 * 60 * 1000;
  const CONTAINER_SELECTOR = '.order-item-content-opt-price';
  const TOTAL_SELECTOR = '[data-pl="order_item_content_price_total"]';
  const COPY_BUTTON_CLASS = 'ae-helper-copy-btn';
  const CAD_ROW_CLASS = 'ae-helper-cad-row';

  let cadRate = null;
  let lastRateFetch = 0;

  const addStyles = () => {
    const css = `
      ${CONTAINER_SELECTOR} { align-items: center; }
      .${COPY_BUTTON_CLASS} {
        background: #1a73e8;
        border: 0;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        line-height: 1;
        margin-right: 8px;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .${COPY_BUTTON_CLASS}:hover { background: #1557b0; }
      .${CAD_ROW_CLASS} {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 6px;
        font-size: 12px;
        color: #222;
      }
      .${CAD_ROW_CLASS} .${COPY_BUTTON_CLASS} { margin-right: 0; }
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

  const formatCad = (value) => `CA $${value.toFixed(2)}`;

  const getUsdText = (totalNode) => {
    const priceNode = totalNode.querySelector('div');
    return (priceNode?.textContent || totalNode.textContent || '').replace(/\s+/g, ' ').trim();
  };

  const ensureRate = async () => {
    const now = Date.now();
    if (cadRate && now - lastRateFetch < RATE_REFRESH_MS) return cadRate;

    try {
      const response = await fetch(RATE_URL, { credentials: 'omit' });
      const data = await response.json();
      if (data && data.rates && typeof data.rates.CAD === 'number') {
        cadRate = data.rates.CAD;
        lastRateFetch = now;
      }
    } catch (error) {
      return cadRate;
    }

    return cadRate;
  };

  const updateCadRow = async (container, totalNode) => {
    const rate = await ensureRate();
    if (!rate) return;

    const usdText = getUsdText(totalNode);
    const usdValue = parseUsd(usdText);
    if (usdValue === null) return;

    const cadValue = formatCad(usdValue * rate);
    let cadRow = container.querySelector(`.${CAD_ROW_CLASS}`);

    if (!cadRow) {
      cadRow = document.createElement('div');
      cadRow.className = CAD_ROW_CLASS;

      const cadLabel = document.createElement('span');
      cadLabel.className = 'ae-helper-cad-label';
      cadLabel.textContent = 'CAD Total:';

      const cadValueNode = document.createElement('span');
      cadValueNode.className = 'ae-helper-cad-value';

      const cadCopy = document.createElement('button');
      cadCopy.type = 'button';
      cadCopy.className = COPY_BUTTON_CLASS;
      cadCopy.textContent = 'Copy';
      cadCopy.addEventListener('click', () => copyText(cadValueNode.textContent || cadValue));

      cadRow.append(cadLabel, cadValueNode, cadCopy);
      container.appendChild(cadRow);
    }

    const cadValueNode = cadRow.querySelector('.ae-helper-cad-value');
    if (cadValueNode) cadValueNode.textContent = cadValue;
  };

  const enhanceTotal = (container) => {
    const totalNode = container.querySelector(TOTAL_SELECTOR);
    if (!totalNode) return;

    if (!container.querySelector(`.${COPY_BUTTON_CLASS}`)) {
      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = COPY_BUTTON_CLASS;
      copyButton.textContent = 'Copy';
      copyButton.addEventListener('click', () => {
        const usdText = getUsdText(totalNode);
        if (usdText) copyText(usdText);
      });

      totalNode.parentElement?.insertBefore(copyButton, totalNode);
    }

    updateCadRow(container, totalNode);
  };

  const scan = () => {
    document.querySelectorAll(CONTAINER_SELECTOR).forEach(enhanceTotal);
  };

  const observe = () => {
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const init = () => {
    addStyles();
    scan();
    observe();
    setInterval(scan, RATE_REFRESH_MS);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

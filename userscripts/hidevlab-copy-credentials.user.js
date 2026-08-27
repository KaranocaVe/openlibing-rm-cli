// ==UserScript==
// @name         HidevLab - Copy openlibing-rm CLI credential
// @namespace    https://github.com/openlibing/openlibing-rm-cli
// @version      0.1.0
// @description  Copy a one-time HidevLab authTicket for importing into openlibing-rm CLI
// @match        https://hidevlab.huawei.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'openlibing-rm-copy-credential';
  const STATUS_ID = 'openlibing-rm-copy-credential-status';
  const AUTH_TICKET_PATH =
    '/hidevlabgatewayservice/com.huawei.ipd.hicomputing.lab:hidevlabservice/hidevlabservice/hwaccount/getOneAccessToken';

  function setStatus(element, state, message) {
    element.textContent = message;
    element.dataset.state = state;
  }

  async function requestAuthTicket() {
    const response = await fetch(AUTH_TICKET_PATH, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`HidevLab credential request failed (HTTP ${response.status})`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error('HidevLab returned an invalid credential response');
    }

    if (payload && payload.code !== undefined && Number(payload.code) !== 200) {
      throw new Error('HidevLab rejected the credential request');
    }

    const ticket = payload && typeof payload.data === 'string' ? payload.data.trim() : '';
    if (!ticket) {
      throw new Error('HidevLab did not return an authTicket; confirm that you are logged in');
    }
    return ticket;
  }

  async function copyToClipboard(value) {
    // Tampermonkey's clipboard API does not require the page to be served from
    // a secure context and remains available after the asynchronous request.
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(value, 'text');
      return;
    }

    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      throw new Error('Clipboard access is unavailable; grant the userscript clipboard permission');
    }
    await navigator.clipboard.writeText(value);
  }

  function mount() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.right = '20px';
    container.style.bottom = '20px';
    container.style.zIndex = '2147483647';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'flex-end';
    container.style.gap = '6px';
    container.style.fontFamily = 'system-ui, -apple-system, sans-serif';

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = '复制 CLI 凭据';
    button.title = '获取一次性 HidevLab authTicket 并复制为 openlibing-rm CLI JSON';
    button.style.border = '0';
    button.style.borderRadius = '6px';
    button.style.padding = '9px 13px';
    button.style.color = '#fff';
    button.style.background = '#2563eb';
    button.style.boxShadow = '0 2px 8px rgba(0, 0, 0, .25)';
    button.style.cursor = 'pointer';

    const status = document.createElement('span');
    status.id = STATUS_ID;
    status.textContent = '仅复制一次性凭据，不会启动环境';
    status.style.maxWidth = '320px';
    status.style.padding = '5px 8px';
    status.style.borderRadius = '4px';
    status.style.color = '#fff';
    status.style.background = 'rgba(0, 0, 0, .68)';
    status.style.fontSize = '12px';
    status.style.lineHeight = '1.4';
    status.style.textAlign = 'right';

    button.addEventListener('click', async () => {
      if (button.disabled) {
        return;
      }

      button.disabled = true;
      button.style.cursor = 'wait';
      setStatus(status, 'busy', '正在从当前登录会话获取凭据…');

      try {
        const authTicket = await requestAuthTicket();
        // Keep the token out of the page, DOM, notifications, and console.
        // The clipboard is the explicit hand-off chosen by the user.
        await copyToClipboard(`${JSON.stringify({ authTicket })}\n`);
        setStatus(status, 'success', '凭据已复制。请立即在终端粘贴导入。');
      } catch {
        // Deliberately use a generic message: response bodies and tickets must
        // never be copied into page-visible errors or browser logs.
        setStatus(status, 'error', '复制失败，请确认已登录并重试。');
      } finally {
        button.disabled = false;
        button.style.cursor = 'pointer';
      }
    });

    container.append(button, status);
    document.body.appendChild(container);
  }

  if (document.body) {
    mount();
  } else {
    window.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();

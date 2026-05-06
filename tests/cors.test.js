const assert = require('node:assert/strict');
const test = require('node:test');
const {
  handleCorsOrigin,
  handleGeneratedPreviewPreflight,
  isAllowedCorsOrigin,
  setGeneratedPreviewHeaders,
} = require('../src/server/app');

test('isAllowedCorsOrigin allows loopback origins by default', () => {
  assert.equal(isAllowedCorsOrigin(undefined, '127.0.0.1'), true);
  assert.equal(isAllowedCorsOrigin('http://localhost:5173', '127.0.0.1'), true);
  assert.equal(isAllowedCorsOrigin('http://127.0.0.1:5173', '127.0.0.1'), true);
});

test('isAllowedCorsOrigin allows the configured host', () => {
  assert.equal(isAllowedCorsOrigin('http://192.168.1.20:5173', '192.168.1.20'), true);
  assert.equal(isAllowedCorsOrigin('http://10.0.0.15:5173', '10.0.0.15'), true);
});

test('isAllowedCorsOrigin allows private LAN origins when bound to all interfaces', () => {
  assert.equal(isAllowedCorsOrigin('http://192.168.1.20:5173', '0.0.0.0'), true);
  assert.equal(isAllowedCorsOrigin('http://172.16.2.10:5173', '0.0.0.0'), true);
  assert.equal(isAllowedCorsOrigin('http://10.1.2.3:5173', '0.0.0.0'), true);
});

test('isAllowedCorsOrigin rejects public and malformed origins', () => {
  assert.equal(isAllowedCorsOrigin('http://203.0.113.10:5173', '0.0.0.0'), false);
  assert.equal(isAllowedCorsOrigin('https://example.com', '127.0.0.1'), false);
  assert.equal(isAllowedCorsOrigin('null', '127.0.0.1'), false);
  assert.equal(isAllowedCorsOrigin('not a url', '127.0.0.1'), false);
});

test('handleCorsOrigin disables CORS headers instead of throwing for rejected origins', () => {
  handleCorsOrigin('https://example.com', (error, allowed) => {
    assert.equal(error, null);
    assert.equal(allowed, false);
  });
});

test('setGeneratedPreviewHeaders allows sandboxed preview assets without opening API CORS', () => {
  const headers = {};
  const response = {
    setHeader(name, value) {
      headers[name] = value;
    },
  };

  setGeneratedPreviewHeaders(response);

  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.equal(headers['Content-Security-Policy'], "frame-ancestors 'self'");
});

test('handleGeneratedPreviewPreflight returns an explicit successful CORS response', () => {
  const headers = {};
  let statusCode = null;
  let ended = false;
  const request = {
    headers: {
      'access-control-request-headers': 'content-type,x-preview-test',
    },
  };
  const response = {
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      statusCode = code;
      return this;
    },
    end() {
      ended = true;
    },
  };

  handleGeneratedPreviewPreflight(request, response);

  assert.equal(statusCode, 204);
  assert.equal(ended, true);
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
  assert.equal(headers['Access-Control-Allow-Methods'], 'GET, HEAD, OPTIONS');
  assert.equal(headers['Access-Control-Allow-Headers'], 'content-type,x-preview-test');
});

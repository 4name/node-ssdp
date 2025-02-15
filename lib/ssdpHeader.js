const { randomBytes } = require('node:crypto');

class SsdpHeader {
  constructor (method, headers = {}, isResponse) {
    if (!method) {
      throw new Error('SSDP header requires method.');
    }
    this._method = method;
    this._headers = { ...headers };
    this._isResponse = isResponse;
    this._id = randomBytes(8).toString('hex');
  }

  id () {
    return this._id;
  }

  setHeader (key, value) {
    if (key !== undefined && value !== undefined) {
      this._headers[key] = value;
    }
  }

  setHeaders (headers) {
    if (headers && headers.toString && headers.toString() === '[object Object]') {
      this._headers = { ...this._headers, ...headers };
    }
  }

  isResponse () {
    return !!this._isResponse;
  }

  overrideLocationOnSend () {
    this._overrideLocationOnSend = true;
  }

  isOverrideLocationOnSend () {
    return !!this._overrideLocationOnSend;
  }

  toString (extraHeaders = {}) {
    // SSDP header values should be simple primitives
    // so not worried here about deep copying or modifying by reference
    const headers = { ...this._headers, ...extraHeaders };
    const message = [];
    const method = this._method.toUpperCase();

    if (this.isResponse()) {
      message.push(`HTTP/1.1 ${method}`);
    } else {
      message.push(`${method} * HTTP/1.1`);
    }

    Object.keys(headers).forEach((header) => {
      message.push(`${header}: ${headers[header]}`);
    });

    message.push('\r\n');
    return message.join('\r\n');
  }

  toBuffer (extraHeaders) {
    return Buffer.from(this.toString(extraHeaders), 'ascii');
  }
}

module.exports = SsdpHeader;

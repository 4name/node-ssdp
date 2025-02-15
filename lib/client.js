'use strict';

/*
 MIT License

 Copyright (c) 2016 Ilya Shaisultanov

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

const SSDP = require('./');
const c = require('./const');
const SsdpHeader = require('./ssdpHeader');

class SsdpClient extends SSDP {
  constructor (opts) {
    super(opts);
    this._subclass = 'node-ssdp:client';
  }

  /**
   * Start the listener for multicast notifications from SSDP devices
   * @param [cb]
   */
  start (cb) {
    return new Promise((resolve, reject) => {
      this._start((err, ...args) => {
        if (cb) {
          cb(err, ...args);
        }
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  /**
   * Close UDP socket.
   */
  stop () {
    this._stop();
  }

  /**
   * Search for a given service type.
   * @param {String} serviceType
   * @returns {*}
   */
  search (serviceType) {
    if (!this._started) {
      return this.start(() => {
        this.search(serviceType);
      });
    }

    const header = new SsdpHeader(c.M_SEARCH, {
      HOST: this._ssdpServerHost,
      ST: serviceType,
      MAN: '"ssdp:discover"',
      MX: 3
    });

    this._logger('Attempting to send an M-SEARCH request');

    this._send(header, (err, bytes) => {
      if (err) {
        this._logger('Error: unable to send M-SEARCH request ID %s: %o', header.id(), err);
      } else {
        this._logger('Sent M-SEARCH request: %o', { message: header.toString(), id: header.id() });
      }
    });
  }
}

module.exports = SsdpClient;

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
const assert = require('node:assert');
const c = require('./const');
const SsdpHeader = require('./ssdpHeader');

class SsdpServer extends SSDP {
  constructor (opts) {
    super(opts);
    this._subclass = 'node-ssdp:server';
    this._adLoopInterval = null;

    if (opts && opts.sourcePort && opts.sourcePort !== c.SSDP_DEFAULT_PORT) {
      this._logger(
        'WARNING: SSDP server `sourcePort` option is set to non-SSDP port. Server will likely receive no messages. It is highly recommended to not pass this option to SSDP server constructor.'
      );
    }

    if (!this._sourcePort) {
      this._sourcePort = c.SSDP_DEFAULT_PORT;
    }
  }

  /**
   * Binds UDP socket to an interface/port
   * and starts advertising.
   *
   * @param [Function] callback to socket.bind
   * @returns [Promise] promise when socket.bind is ready
   */
  start (cb) {
    if (this._socketBound) {
      this._logger('Server already running.');
      return;
    }

    this._socketBound = true;

    if (!this._suppressRootDeviceAdvertisements) {
      this._usns[this._udn] = this._udn;
    }

    return new Promise((resolve, reject) => {
      this._start((err, ...args) => {
        this._initAdLoop(err, ...args);
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
   * Binds UDP socket
   *
   * @param ipAddress
   * @private
   */
  _initAdLoop (...args) {
    // Wake up.
    setTimeout(() => this.advertise(), 3_000);
    this._startAdLoop();
  }

  /**
   * Advertise shutdown and close UDP socket.
   */
  stop () {
    if (!this.sockets) {
      this._logger('Already stopped.');
      return;
    }

    this.advertise(false);
    this._stopAdLoop();
    this._stop();
  }

  _startAdLoop () {
    assert.strictEqual(
      this._adLoopInterval,
      null,
      'Attempting to start a parallel ad loop'
    );
    this._adLoopInterval = setInterval(() => this.advertise(), this._adInterval);
  }

  _stopAdLoop () {
    assert.notStrictEqual(
      this._adLoopInterval,
      null,
      'Attempting to clear a non-existing interval'
    );
    clearInterval(this._adLoopInterval);
    this._adLoopInterval = null;
  }

  /**
   *
   * @param alive
   */
  advertise (alive = true) {
    if (!this.sockets) {
      return;
    }

    Object.keys(this._usns).forEach((usn) => {
      const udn = this._usns[usn];
      const nts = alive ? c.SSDP_ALIVE : c.SSDP_BYE; // notification sub-type

      const header = new SsdpHeader(c.NOTIFY, {
        HOST: this._ssdpServerHost,
        NT: usn, // notification type, in this case same as ST
        NTS: nts,
        USN: udn
      });

      if (alive) {
        if (this._location) {
          header.setHeader('LOCATION', this._location);
        } else {
          header.overrideLocationOnSend();
        }
        header.setHeader('CACHE-CONTROL', 'max-age=1800');
        header.setHeader('SERVER', this._ssdpSig);
      }

      header.setHeaders(this._extraHeaders);

      this._logger('Sending an advertisement event');

      this._send(header, (err, bytes) => {
        this._logger('Outgoing server message: %o', {
          message: header.toString(),
          id: header.id()
        });
      });
    });
  }
}

module.exports = SsdpServer;

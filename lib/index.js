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

const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');
const debug = require('debug');
const os = require('node:os');
const async = require('async');
const SsdpHeader = require('./ssdpHeader');

const httpHeader = /HTTP\/\d{1}\.\d{1} \d+ .*/;
const ssdpHeader = /^([^:]+):\s*(.*)$/;

/* consts */
const c = require('./const');

const nodeVersion = process.version.substr(1);
const moduleVersion = require('../package.json').version;
const moduleName = require('../package.json').name;

class SSDP extends EventEmitter {
  /**
   * Options:
   *
   * @param {Object} opts
   * @param {String} opts.ssdpSig SSDP signature
   * @param {String} opts.ssdpIp SSDP multicast group
   * @param {String} opts.ssdpPort SSDP port
   * @param {Number} opts.ssdpTtl Multicast TTL
   * @param {Number} opts.adInterval Interval at which to send out advertisement (ms)
   * @param {String} opts.description Path to SSDP description file
   * @param {String} opts.udn SSDP Unique Device Name
   * @param {Object} opts.headers Additional headers
   * @param {Array} opts.interfaces Names of interfaces to use. When set, other interfaces are ignored.
   *
   * @param {Number} opts.ttl Packet TTL
   * @param {Boolean} opts.allowWildcards Allow wildcards in M-SEARCH packets (non-standard)
   */
  constructor (opts = {}) {
    super();
    this._subclass = this._subclass || 'node-ssdp:base';
    this._logger = opts.customLogger || debug(this._subclass);
    this._init(opts);
  }

  /**
   * Initializes instance properties.
   * @param opts
   * @private
   */
  _init (opts) {
    this._ssdpSig = opts.ssdpSig || getSsdpSignature();

    this._explicitSocketBind = opts.explicitSocketBind;
    this._interfaces = opts.interfaces;
    this._reuseAddr = typeof opts.reuseAddr === undefined ? true : opts.reuseAddr;

    // User shouldn’t need to set these
    this._ssdpIp = opts.ssdpIp || c.SSDP_DEFAULT_IP;
    this._ssdpPort = opts.ssdpPort || c.SSDP_DEFAULT_PORT;
    this._ssdpTtl = opts.ssdpTtl || 4;

    // port on which to listen for messages
    // this generally should be left up to the system for SSDP Client
    // For server, this will be set by the server constructor
    // unless user sets a value.
    this._sourcePort = opts.sourcePort || 0;
    this._adInterval = opts.adInterval || 10_000;
    this._ttl = opts.ttl || 1_800;

    if (typeof opts.location === 'function') {
      Object.defineProperty(this, '_location', {
        enumerable: true,
        get: opts.location
      });
    } else if (typeof opts.location === 'object') {
      this._locationProtocol = opts.location.protocol || 'http://';
      this._locationPort = opts.location.port;
      this._locationPath = opts.location.path;
    } else {
      // Probably should specify this explicitly
      this._location = opts.location || `http://${this._getLocalIPAddress()}:10293/upnp/desc.html`;
    }

    this._ssdpServerHost = `${this._ssdpIp}:${this._ssdpPort}`;
    this._usns = {};
    this._udn = opts.udn || 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5';
    this._extraHeaders = opts.headers || {};
    this._allowWildcards = opts.allowWildcards;
    this._suppressRootDeviceAdvertisements = opts.suppressRootDeviceAdvertisements;
  }

  _getLocalIPAddress () {
    const interfaces = os.networkInterfaces();
    for (const ifaceName of Object.keys(interfaces)) {
      for (const iface of interfaces[ifaceName]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return undefined;
  }

  /**
   * Creates and returns UDP4 socket.
   *
   * @returns {Socket}
   * @private
   */
  _createSockets () {
    const interfaces = os.networkInterfaces();
    this.sockets = {};

    Object.keys(interfaces).forEach((iName) => {
      if (!this._interfaces || this._interfaces.indexOf(iName) > -1) {
        this._logger('discovering all IPs from interface %s', iName);
        interfaces[iName].forEach((ipInfo) => {
          if (ipInfo.internal === false && ipInfo.family === 'IPv4') {
            this._logger('Will use interface %s', iName);
            const socket = dgram.createSocket({ type: 'udp4', reuseAddr: this._reuseAddr });
            if (socket) {
              socket.unref();
              this.sockets[ipInfo.address] = socket;
            }
          }
        });
      }
    });

    if (Object.keys(this.sockets).length === 0) {
      throw new Error('No sockets available, cannot start.');
    }
  }

  /**
   * Advertise shutdown and close UDP sockets.
   */
  _stop () {
    if (!this.sockets) {
      this._logger('Already stopped.');
      return;
    }

    Object.keys(this.sockets).forEach((ipAddress) => {
      const socket = this.sockets[ipAddress];
      if (socket) {
        socket.close();
      }
      this._logger('Stopped socket on %s', ipAddress);
    });

    this.sockets = null;
    this._socketBound = this._started = false;
  }

  /**
   * Configures UDP socket `socket`.
   * Binds event listeners.
   */
  _start (cb) {
    if (this._started) {
      this._logger('Already started.');
      return;
    }

    if (!this.sockets) {
      this._createSockets();
    }

    this._started = true;
    const interfaces = Object.keys(this.sockets);

    async.each(
      interfaces,
      (iface, next) => {
        const socket = this.sockets[iface];

        socket.on('error', function onSocketError (err) {
          this._logger('Socket error: %s', err.message);
        }.bind(this));

        socket.on('message', function onSocketMessage (msg, rinfo) {
          this._parseMessage(msg, rinfo);
        }.bind(this));

        socket.on('listening', function onSocketListening () {
          const addr = socket.address();
          this._logger('SSDP listening: %o', {
            address: `http://${addr.address}:${addr.port}`,
            interface: iface
          });

          const addMembership = () => {
            socket.addMembership(this._ssdpIp, iface); // TODO: specifying the interface in there might make a difference
            socket.setMulticastTTL(this._ssdpTtl);
          };

          const delay = () =>
            new Promise((resolve) => {
              setTimeout(resolve, 5_000);
            });

          try {
            addMembership();
          } catch (e) {
            if (e.code === 'ENODEV' || e.code === 'EADDRNOTAVAIL') {
              this._logger(
                'Interface %s is not present to add multicast group membership. Scheduling a retry. Error: %s',
                addr,
                e.message
              );
              delay().then(addMembership).catch((err) => {
                throw err;
              });
            } else {
              throw e;
            }
          }
        }.bind(this));

        if (this._explicitSocketBind) {
          socket.bind(this._sourcePort, iface, next);
        } else {
          socket.bind(this._sourcePort, next); // binds on 0.0.0.0
        }
      },
      cb
    );
  }

  /**
   * Routes a network message to the appropriate handler.
   *
   * @param msg
   * @param rinfo
   */
  _parseMessage (msg, rinfo) {
    msg = msg.toString();
    const type = msg.split('\r\n').shift();

    // HTTP/#.# ### Response to M-SEARCH
    if (httpHeader.test(type)) {
      this._parseResponse(msg, rinfo);
    } else {
      this._parseCommand(msg, rinfo);
    }
  }

  /**
   * Parses SSDP command.
   *
   * @param msg
   * @param rinfo
   */
  _parseCommand (msg, rinfo) {
    const method = this._getMethod(msg);
    const headers = this._getHeaders(msg);

    switch (method) {
      case c.NOTIFY:
        this._notify(headers, msg, rinfo);
        break;
      case c.M_SEARCH:
        this._msearch(headers, msg, rinfo);
        break;
      default:
        this._logger('Unhandled command: %o', { message: msg, rinfo });
    }
  }

  /**
   * Handles NOTIFY command
   * Emits `advertise-alive`, `advertise-bye` events.
   *
   * @param headers
   * @param msg
   * @param rinfo
   */
  _notify (headers, msg, rinfo) {
    if (!headers.NTS) {
      this._logger('Missing NTS header: %o', headers);
      return;
    }

    switch (headers.NTS.toLowerCase()) {
      // Device coming to life.
      case c.SSDP_ALIVE:
        this.emit(c.ADVERTISE_ALIVE, headers, rinfo);
        break;
      // Device shutting down.
      case c.SSDP_BYE:
        this.emit(c.ADVERTISE_BYE, headers, rinfo);
        break;
      default:
        this._logger('Unhandled NOTIFY event: %o', { message: msg, rinfo });
    }
  }

  /**
   * Handles M-SEARCH command.
   *
   * @param headers
   * @param msg
   * @param rinfo
   */
  _msearch (headers, msg, rinfo) {
    this._logger('SSDP M-SEARCH event: %o', {
      ST: headers.ST,
      address: rinfo.address,
      port: rinfo.port
    });

    if (!headers.MAN || !headers.MX || !headers.ST) {
      return;
    }
    this._respondToSearch(headers.ST, rinfo);
  }

  /**
   * Sends out a response to M-SEARCH commands.
   *
   * @param {String} serviceType Service type requested by a client
   * @param {Object} rinfo Remote client's address
   * @private
   */
  _respondToSearch (serviceType, rinfo) {
    const peer_addr = rinfo.address;
    const peer_port = rinfo.port;
    let stRegex;
    let acceptor;

    // unwrap quoted string
    if (serviceType[0] === '"' && serviceType[serviceType.length - 1] === '"') {
      serviceType = serviceType.slice(1, -1);
    }

    if (this._allowWildcards) {
      stRegex = new RegExp(serviceType.replace(/\*/g, '.*') + '$');
      acceptor = (usn, serviceType) => (serviceType === c.SSDP_ALL || stRegex.test(usn));
    } else {
      acceptor = (usn, serviceType) => (serviceType === c.SSDP_ALL || usn === serviceType);
    }

    Object.keys(this._usns).forEach((usn) => {
      let udn = this._usns[usn];

      if (this._allowWildcards) {
        udn = udn.replace(stRegex, serviceType);
      }

      if (acceptor(usn, serviceType)) {
        const header = new SsdpHeader(
          '200 OK',
          {
            ST: serviceType === c.SSDP_ALL ? usn : serviceType,
            USN: udn,
            'CACHE-CONTROL': `max-age=${this._ttl}`,
            DATE: new Date().toUTCString(),
            SERVER: this._ssdpSig,
            EXT: ''
          },
          true
        );

        header.setHeaders(this._extraHeaders);

        if (this._location) {
          header.setHeader('LOCATION', this._location);
        } else {
          header.overrideLocationOnSend();
        }

        this._logger('Sending a 200 OK for an M-SEARCH: %o', {
          peer: peer_addr,
          port: peer_port
        });

        this._send(header, peer_addr, peer_port, (err, bytes) => {
          this._logger('Sent M-SEARCH response: %o', {
            message: header.toString(),
            id: header.id()
          });
        });
      }
    });
  }

  /**
   * Parses SSDP response message.
   *
   * @param msg
   * @param rinfo
   */
  _parseResponse (msg, rinfo) {
    this._logger('SSDP response: %o', { message: msg });
    const headers = this._getHeaders(msg);
    const statusCode = this._getStatusCode(msg);
    this.emit('response', headers, statusCode, rinfo);
  }

  addUSN (device) {
    this._usns[device] = `${this._udn}::${device}`;
  }

  _getMethod (msg) {
    const lines = msg.split('\r\n');
    const type = lines.shift().split(' ');
    // command, such as "NOTIFY * HTTP/1.1"
    const method = (type[0] || '').toLowerCase();
    return method;
  }

  _getStatusCode (msg) {
    const lines = msg.split('\r\n');
    const type = lines.shift().split(' ');
    // command, such as "NOTIFY * HTTP/1.1"
    const code = parseInt(type[1], 10);
    return code;
  }

  _getHeaders (msg) {
    const lines = msg.split('\r\n');
    const headers = {};
    lines.forEach((line) => {
      if (line.length) {
        const pairs = line.match(ssdpHeader);
        if (pairs) {
          // e.g. {'HOST': 239.255.255.250:1900}
          headers[pairs[1].toUpperCase()] = pairs[2];
        }
      }
    });
    return headers;
  }

  _send (message, host, port, cb) {
    if (typeof host === 'function') {
      cb = host;
      host = this._ssdpIp;
      port = this._ssdpPort;
    }

    const ipAddresses = Object.keys(this.sockets);

    async.each(
      ipAddresses,
      (ipAddress, next) => {
        const socket = this.sockets[ipAddress];
        let buf;
        if (message instanceof SsdpHeader) {
          if (message.isOverrideLocationOnSend()) {
            const location = `${this._locationProtocol}${ipAddress}:${this._locationPort}${this._locationPath}`;
            this._logger('Setting LOCATION header "%s" on message ID %s', location, message.id());
            buf = message.toBuffer({ LOCATION: location });
          } else {
            buf = message.toBuffer();
          }
        } else {
          buf = message;
        }
        this._logger('Sending a message to %s:%s', host, port);
        socket.send(buf, 0, buf.length, port, host, next);
      },
      cb
    );
  }
}

function getSsdpSignature () {
  return `node.js/${nodeVersion} UPnP/1.1 ${moduleName}/${moduleVersion}`;
}

module.exports = SSDP;

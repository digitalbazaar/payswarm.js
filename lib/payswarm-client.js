/**
 * A JavaScript implementation of the PaySwarm API.
 *
 * @author Dave Longley
 *
 * Copyright (c) 2011-2013, Digital Bazaar, Inc.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * * Neither the name of Digital Bazaar, Inc. nor the names of its contributors
 *   may be used to endorse or promote products derived from this software
 *   without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

'use strict';

var async = require('async');
var crypto = require('crypto');
var fs = require('fs');
var jsonld = require('jsonld')(); // get localized jsonld API
var mkdirp = require('mkdirp');
var path = require('path');
var URL = require('url');
var ursa = require('ursa');
var util = require('util');

jsonld.use('request');

var api = {};
module.exports = api;

/*

PAYSWARM CLIENT API
-------------------

The PaySwarm Client API allows vendors to register with a PaySwarm Authority,
sign listings for the items they wish to sell, and receive payments from
their customers.

INSTRUCTIONS
------------

First, implement all of the required hooks. Various hooks will be triggered
when making calls to the API. Most of the hooks involve providing the API with
a custom mechanism for doing HTTP GET/POST and storing/retrieving data from
a database. It is also highly recommended that the optional cache hooks be
implemented to prevent excessive network traffic when looking up PaySwarm
Authority configurations and public keys. To implement a hook, simply write
a function that takes the appropriate parameters and returns the appropriate
values. Then pass the hook name and the name of the custom function to
'payswarm.addHook'. Look below for the specific hooks that must be implemented.

Next, use the API to register as a vendor on the PaySwarm Authority of
choice, sign listings, and accept payments via customers' chosen PaySwarm
Authorities.

First, require this module:

var payswarm = require('payswarm');

Then:

1. Add the PaySwarm Authorities that should be trusted by calling:

  payswarm.addTrustedAuthority('trustedauthority:port');

  In this version of the API, any customer's PaySwarm Authority that the vendor
  would like to do business with must be manually added. The vendor's chosen
  PaySwarm Authority will be automatically added during the registration
  step.

2. Register as a vendor by calling:

  var url = payswarm.getRegisterVendorUrl(
    'myauthority:port',
    'http://myserver/myregistercallbackurl',
    callback);

  The first parameter is the host and port of the PaySwarm Authority to
  register with. The second is a callback URL that will receive the result of
  the registration as POST data.

  Direct the vendor to the URL so that they can complete the registration
  process. Once the registration process is complete, the vendor's browser
  will POST the registration result to the callback URL provided.

3. On the callback page, get the POST value 'encrypted-message' and pass it
  to register the vendor:

  payswarm.registerVendor(
    req.body['encrypted-message'], {
      privateKey: 'your private key in PEM format',
    }, callback);

  If no error is given to the callback, registration is complete. The second
  callback parameter is the PaySwarm Vendor's Preferences, including the
  Financial Account ID to use in Listings.

5. Create a JSON-LD PaySwarm Asset and Listing. When listing an Asset, its
  unique hash must be in the Listing. To generate an asset hash call:

  payswarm.hash(asset, callback);

4. Sign a listing. Create a JSON-LD PaySwarm Listing and then sign it:

  payswarm.sign(listing, callback);

  Display the listing information; the use of RDFa is recommended. Depending
  on the application's needs, it is sometimes a good idea (or a requirement)
  to regenerate signatures when the vendor's public key is changed.

  Note: A Listing also contains a License for the Asset. If the application
  knows the ID (IRI) of the License to use but not the License hash, and it
  does not have the necessary parser to obtain the License information from
  its ID, it may use the PaySwarm Authority's license service to cache and
  retrieve the License by its ID. Then payswarm.hash(license, callback) can
  be called on the result to produce its hash.

5. When a customer indicates that they want to purchase the Asset in a
  Listing, call:

  var url = payswarm.getPurchaseUrl(
    'customersauthority:port',
    listingId,
    listingHash,
    'https://myserver/mypurchasecallbackurl',
    callback);

  To get a URL to redirect the customer to their PaySwarm Authority to
  complete the purchase. The last parameter is a callback URL that will
  receive the result of the purchase as POST data.

  If the customer has previously completed a purchase and the response
  indicated that they set up a budget to handle automated purchases in the
  future, then an automated purchase can be attempted by calling:

  payswarm.purchase(
    'customersauthority:port',
    'https://customersauthority:port/i/customer',
    listingId,
    listingHash,
    callback);

  In this version of the API, it is the responsibility of the application to
  determine the customer's PaySwarm Authority (usually by asking). A listing
  hash can be generated by calling:

  payswarm.hash(listing, callback);

  To get the JSON-LD receipt from a purchase, call:

  payswarm.getReceipt(encryptedMessage, {
    privateKey: 'your private key in PEM format',
  }, callback);

  Where encryptedMessage is either the result of a POST to the purchase
  callback or the result of the payswarm.purchase() call.

  The receipt will indicate the ID and hash of the Asset purchased as well
  as the ID and hash of the License for the Asset.

*/

// FIXME: ported from PHP, use more nodejs-like idioms, pass 'cache' or
// 'store' objects that have interfaces to be implemented, etc.

// hook API
var hooks = {};

/**
 * Adds a hook. To add a hook, pass the name of the hook (eg: createNonce) and
 * the user-defined function name to be called. Hooks are permitted to throw
 * exceptions as are any PaySwarm client API calls. API calls should be
 * wrapped in try/catch blocks as appropriate.
 *
 * Required protocol hooks:
 *
 * createNonce(): Creates and stores a nonce that is to be given to a
 *   PaySwarm Authority so it can be returned in a signed and encrypted
 *   message.
 *
 * checkNonce(nonce, callback(err, valid)): Checks a nonce previously created
 *   by createNonce and removes it from storage. Passes true in the callback
 *   if the nonce is valid, false if not.
 *
 * Required storage hooks:
 *
 * getPublicKey(callback(err, key)): Passes the vendor's public key in PEM
 * format to the callback.
 *
 * getPublicKeyId(callback(err, id)): Passes the ID (IRI) for the vendor's
 * public key to the callback.
 *
 * getPrivateKey(callback(err, key)): Passes the vendor's private key in
 * PEM format to the callback.
 *
 * isTrustedAuthority(id, callback(err, trusted)): Passes true to the
 *   callback if the given identity (IRI) is a trusted PaySwarm Authority,
 *   false if not.
 *
 * storeKeyPair(publicPem, privatePem, callback(err)): Stores the vendor's
 * key pair.
 *
 * storePublicKeyId(id, callback(err)): Stores the vendor's public key ID
 * (IRI).
 *
 * storeTrustedAuthority(id, callback(err)): Stores the ID (IRI) of a trusted
 *   PaySwarm Authority.
 *
 * Optional retrieval hooks:
 *
 * getJsonLd(url, [options,] callback(err, result)): Performs a HTTP GET and
 *   calls a callback with the parsed JSON-LD result object using the
 *   jsonld.request function and options.
 *
 * postJsonLd(url, data, [options,] callback(err, result)): Performs a HTTP
 *   POST of the given JSON-LD data and calls a callback with the parsed
 *   JSON-LD result object (if any) using the jsonld.request function and
 *   options.
 *
 * Optional cache hooks:
 *
 * cacheJsonLd(id, obj, secs, callback(err)): Caches a JSON-LD object. The
 *   ID (IRI) for the object is given and the maxmimum number of seconds to
 *   cache.
 *
 * getCachedJsonLd(id, callback(err, result)): Gets a JSON-LD object from
 *   cache. Passes the object or null to the callback.
 *
 * @param hook the name of the hook.
 * @param func the name of the function to call.
 */
api.addHook = function(hook, func) {
  hooks[hook] = func;
};

/**
 * Versioned PaySwarm JSON-LD context URLs.
 */
api.CONTEXT_V1_URL = "https://w3id.org/payswarm/v1";

/**
 * Default PaySwarm JSON-LD context URL.
 */
api.CONTEXT_URL = api.CONTEXT_V1_URL;

/**
 * Supported PaySwarm JSON-LD contexts.
 */
api.CONTEXTS = {};

/**
 * V1 PaySwarm JSON-LD context.
 */
api.CONTEXTS[api.CONTEXT_V1_URL] = {
  // aliases
  'id': '@id',
  'type': '@type',

  // prefixes
  'ccard': 'https://w3id.org/commerce/creditcard#',
  'com': 'https://w3id.org/commerce#',
  'dc': 'http://purl.org/dc/terms/',
  'foaf': 'http://xmlns.com/foaf/0.1/',
  'gr': 'http://purl.org/goodrelations/v1#',
  'pto': 'http://www.productontology.org/id/',
  'ps': 'https://w3id.org/payswarm#',
  'rdf': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  'rdfs': 'http://www.w3.org/2000/01/rdf-schema#',
  'sec': 'https://w3id.org/security#',
  'vcard': 'http://www.w3.org/2006/vcard/ns#',
  'xsd': 'http://www.w3.org/2001/XMLSchema#',

  // general
  'address': {'@id': 'vcard:adr', '@type': '@id'},
  'comment': 'rdfs:comment',
  'countryName': 'vcard:country-name',
  'created': {'@id': 'dc:created', '@type': 'xsd:dateTime'},
  'creator': {'@id': 'dc:creator', '@type': '@id'},
  'depiction': {'@id': 'foaf:depiction', '@type': '@id'},
  'description': 'dc:description',
  'email': 'foaf:mbox',
  'fullName': 'vcard:fn',
  'label': 'rdfs:label',
  'locality': 'vcard:locality',
  'postalCode': 'vcard:postal-code',
  'region': 'vcard:region',
  'streetAddress': 'vcard:street-address',
  'title': 'dc:title',
  'website': {'@id': 'foaf:homepage', '@type': '@id'},
  'Address': 'vcard:Address',

  // bank
  'bankAccount': 'bank:account',
  'bankAccountType': {'@id': 'bank:accountType', '@type': '@vocab'},
  'bankRoutingNumber': 'bank:routing',
  'BankAccount': 'bank:BankAccount',
  'Checking': 'bank:Checking',
  'Savings': 'bank:Savings',

  // credit card
  'cardBrand': {'@id': 'ccard:brand', '@type': '@vocab'},
  'cardCvm': 'ccard:cvm',
  'cardExpMonth': {'@id': 'ccard:expMonth', '@type': 'xsd:integer'},
  'cardExpYear': {'@id': 'ccard:expYear', '@type': 'xsd:integer'},
  'cardNumber': 'ccard:number',
  'AmericanExpress': 'ccard:AmericanExpress',
  'ChinaUnionPay': 'ccard:ChinaUnionPay',
  'CreditCard': 'ccard:CreditCard',
  'Discover': 'ccard:Discover',
  'Visa': 'ccard:Visa',
  'MasterCard': 'ccard:MasterCard',

  // commerce
  'account': {'@id': 'com:account', '@type': '@id'},
  'amount': 'com:amount',
  'authorized': {'@id': 'com:authorized', '@type': 'xsd:dateTime'},
  'balance': 'com:balance',
  'currency': {'@id': 'com:currency', '@type': '@vocab'},
  'destination': {'@id': 'com:destination', '@type': '@id'},
  'maximumAmount': 'com:maximumAmount',
  'maximumPayeeRate': 'com:maximumPayeeRate',
  'minimumPayeeRate': 'com:minimumPayeeRate',
  'minimumAmount': 'com:minimumAmount',
  'payee': {'@id': 'com:payee', '@type': '@id', '@container': '@set'},
  'payeeApplyAfter': {'@id': 'com:payeeApplyAfter', '@container': '@set'},
  'payeeApplyGroup': {'@id': 'com:payeeApplyGroup', '@container': '@set'},
  'payeeApplyType': {'@id': 'com:payeeApplyType', '@type': '@vocab'},
  'payeeGroup': {'@id': 'com:payeeGroup', '@container': '@set'},
  'payeeGroupPrefix': {'@id': 'com:payeeGroupPrefix', '@container': '@set'},
  'payeeExemptGroup': {'@id': 'com:payeeExemptGroup', '@container': '@set'},
  'payeeLimitation': {'@id': 'com:payeeLimitation', '@type': '@vocab'},
  'payeeRate': 'com:payeeRate',
  'payeeRateType': {'@id': 'com:payeeRateType', '@type': '@vocab'},
  'payeeRule': {'@id': 'com:payeeRule', '@type': '@id', '@container': '@set'},
  'paymentGateway': 'com:paymentGateway',
  'paymentMethod': {'@id': 'com:paymentMethod', '@type': '@vocab'},
  'paymentToken': 'com:paymentToken',
  'referenceId': 'com:referenceId',
  'settled': {'@id': 'com:settled', '@type': 'xsd:dateTime'},
  'source': {'@id': 'com:source', '@type': '@id'},
  'transfer': {'@id': 'com:transfer', '@type': '@id', '@container': '@set'},
  'vendor': {'@id': 'com:vendor', '@type': '@id'},
  'voided': {'@id': 'com:voided', '@type': 'xsd:dateTime'},
  'ApplyExclusively': 'com:ApplyExclusively',
  'ApplyInclusively': 'com:ApplyInclusively',
  'FinancialAccount': 'com:Account',
  'FlatAmount': 'com:FlatAmount',
  'Deposit': 'com:Deposit',
  'NoAdditionalPayeesLimitation': 'com:NoAdditionalPayeesLimitation',
  'Payee': 'com:Payee',
  'PayeeRule': 'com:PayeeRule',
  'PayeeScheme': 'com:PayeeScheme',
  'PaymentToken': 'com:PaymentToken',
  'Percentage': 'com:Percentage',
  'Transaction': 'com:Transaction',
  'Transfer': 'com:Transfer',
  'Withdrawal': 'com:Withdrawal',

  // currencies
  'USD': 'https://w3id.org/currencies/USD',

  // error
  // FIXME: add error terms
  // 'errorMessage': 'err:message'

  // payswarm
  'asset': {'@id': 'ps:asset', '@type': '@id'},
  'assetAcquirer': {'@id': 'ps:assetAcquirer', '@type': '@id'},
  // FIXME: support inline content
  'assetContent': {'@id': 'ps:assetContent', '@type': '@id'},
  'assetHash': 'ps:assetHash',
  'assetProvider': {'@id': 'ps:assetProvider', '@type': '@id'},
  'authority': {'@id': 'ps:authority', '@type': '@id'},
  'contract': {'@id': 'ps:contract', '@type': '@id'},
  'identityHash': 'ps:identityHash',
  // FIXME: move?
  'ipv4Address': 'ps:ipv4Address',
  'license': {'@id': 'ps:license', '@type': '@id'},
  'licenseHash': 'ps:licenseHash',
  'licenseTemplate': 'ps:licenseTemplate',
  'licenseTerms': {'@id': 'ps:licenseTerms', '@type': '@id'},
  'listing': {'@id': 'ps:listing', '@type': '@id'},
  'listingHash': 'ps:listingHash',
  'listingRestrictions': {'@id': 'ps:listingRestrictions', '@type': '@id'},
  'preferences': {'@id': 'ps:preferences', '@type': '@vocab'},
  'validFrom': {'@id': 'ps:validFrom', '@type': 'xsd:dateTime'},
  'validUntil': {'@id': 'ps:validUntil', '@type': 'xsd:dateTime'},
  'Asset': 'ps:Asset',
  'Budget': 'ps:Budget',
  'Contract': 'ps:Contract',
  'License': 'ps:License',
  'Listing': 'ps:Listing',
  'PersonalIdentity': 'ps:PersonalIdentity',
  'IdentityPreferences': 'ps:IdentityPreferences',
  'Profile': 'ps:Profile',
  'PurchaseRequest': 'ps:PurchaseRequest',
  'PreAuthorization': 'ps:PreAuthorization',
  'Receipt': 'ps:Receipt',
  'VendorIdentity': 'ps:VendorIdentity',

  // security
  'cipherAlgorithm': 'sec:cipherAlgorithm',
  'cipherData': 'sec:cipherData',
  'cipherKey': 'sec:cipherKey',
  'digestAlgorithm': 'sec:digestAlgorithm',
  'digestValue': 'sec:digestValue',
  'expiration': {'@id': 'sec:expiration', '@type': 'xsd:dateTime'},
  'initializationVector': 'sec:initializationVector',
  'nonce': 'sec:nonce',
  'normalizationAlgorithm': 'sec:normalizationAlgorithm',
  'owner': {'@id': 'sec:owner', '@type': '@id'},
  'password': 'sec:password',
  'privateKey': {'@id': 'sec:privateKey', '@type': '@id'},
  'privateKeyPem': 'sec:privateKeyPem',
  'publicKey': {'@id': 'sec:publicKey', '@type': '@id'},
  'publicKeyPem': 'sec:publicKeyPem',
  'publicKeyService': {'@id': 'sec:publicKeyService', '@type': '@id'},
  'revoked': {'@id': 'sec:revoked', '@type': 'xsd:dateTime'},
  'signature': 'sec:signature',
  'signatureAlgorithm': 'sec:signatureAlgorithm',
  'signatureValue': 'sec:signatureValue',
  'EncryptedMessage': 'sec:EncryptedMessage',
  'CryptographicKey': 'sec:Key',
  'GraphSignature2012': 'sec:GraphSignature2012'
};

/**
 * Default PaySwarm JSON-LD context.
 */
api.CONTEXT = api.CONTEXTS[api.CONTEXT_URL];

/**
 * PaySwarm JSON-LD frames.
 */
api.FRAMES = {};

/** PaySwarm JSON-LD frame for an Asset. */
api.FRAMES.Asset = {
  '@context': api.CONTEXT_URL,
  type: 'Asset',
  creator: {},
  signature: {'@embed': true},
  assetProvider: {'@embed': false}
};

/** PaySwarm JSON-LD frame for a License. */
api.FRAMES.License = {
  '@context': api.CONTEXT_URL,
  type: 'License'
};

/** PaySwarm JSON-LD frame for a Listing. */
api.FRAMES.Listing = {
  '@context': api.CONTEXT_URL,
  type: 'Listing',
  asset: {'@embed': false},
  license: {'@embed': false},
  vendor: {'@embed': false},
  signature: {'@embed': true}
};

/**
 * Determines the configuration filename based on the given name and
 * PaySwarm-specific defaults. This method will always return a filename.
 *
 * @param configName the name of the config file, which can be null
 *          (the default config), a pathname, or a nickname for a
 *          previously saved configuration file.
 * @param callback(err, filename) called when the config has been read.
 */
api.getConfigFilename = function(configName, callback) {
  if(configName) {
    // TODO: check if it's a dir (not a file) and error out early?
    // if configName is an absolute path use it
    var normalized = path.normalize(configName);
    if(path.resolve(normalized) === normalized) {
      return callback(null, configName);
    }
  }

  // establish base config directory
  var baseConfigDir = path.resolve(process.env.HOME);
  if(process.env.XDG_CONFIG_HOME) {
    baseConfigDir = path.resolve(process.env.XDG_CONFIG_HOME);
  }

  // if a config name was not given, use the default
  if(!configName) {
    var configFilename = path.join(
      baseConfigDir, '.config', 'payswarm1', 'default');
    return callback(null, configFilename);
  }

  // if a valid relative file name was given, use that
  var relativeFile = path.resolve(configName);
  fs.exists(relativeFile, function(exists) {
    if(exists) {
      return callback(null, relativeFile);
    }
    // if a config name was given, use that
    var configFilename = path.join(
      baseConfigDir, '.config', 'payswarm1', configName);
    callback(null, configFilename);
  });
};

/**
 * Reads configuration information from a file if the file exists, or just
 * returns an empty configuration object if it doesn't.
 *
 * @param configName the name of the config file, which can be a pathname
 *          or a nickname for a saved configuration file.
 * @param callback(err, config) called when the config has been read.
 */
api.readConfig = function(configName, callback) {
  var cfg = {};

  async.waterfall([
    function(callback) {
      api.getConfigFilename(configName, callback);
    },
    function(configFilename, callback) {
      // attempt to read data from the config file
      fs.exists(configFilename, function(exists) {
        if(exists) {
          return fs.readFile(configFilename, 'utf8', callback);
        }
        callback(new Error('Config file does not exist: '+ configFilename));
      });
    },
    function(data, callback) {
      cfg = JSON.parse(data);
      // add the default context to the object
      callback(null, cfg);
    }], function(err) {
      cfg['@context'] = 'https://w3id.org/payswarm/v1';
      callback(err, cfg);
  });
};

/**
 * Writes a configuration out to disk.
 *
 * @param configName the name of the config file.
 * @param cfg the configuration object to write.
 * @param callback(err, configFilename) the callback called when the file is
 *          written to disk.
 */
api.writeConfig = function(configName, cfg, callback) {
  async.waterfall([
    function(callback) {
      api.getConfigFilename(configName, callback);
    },
    function(configFilename, callback) {
      var configDir = path.dirname(configFilename);
      // if the directory for the config file doesn't exist, create it
      fs.exists(configDir, function(exists) {
        if(exists) {
          callback(null, configFilename);
        } else {
          mkdirp(configDir, parseInt(700, 8), function(err) {
            if(err) {
              return callback(err);
            }
            callback(null, configFilename);
          });
        }
      });
    },
    function(configFilename, callback) {
      // write the data to disk
      var data = JSON.stringify(cfg, null, 2);
      fs.writeFile(
        configFilename, data, {encoding: 'utf8', mode: parseInt(600, 8)},
        function(err) {
        if(err) {
          return callback(err);
        }
        callback(null, configFilename);
      });
  }], callback);
};

/**
 * Retrieves a JSON-LD object over HTTP.
 *
 * @param url the URL to HTTP GET.
 * @param options: (optional)
 *          cache: true to cache the response. [false] (optional)
 *          request: options for the request. (optional)
 * @param callback(err, result) called once the operation completes.
 */
api.getJsonLd = function(url, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options.request = options.request || {};

  async.waterfall([
    function(callback) {
      // use cache if available
      api.getCachedJsonLd(url, callback);
    },
    function(result, callback) {
      if(result) {
        return callback(null, result);
      }

      // retrieve JSON-LD
      hooks.getJsonLd(url, options.request, callback);
    },
    function(result, callback) {
      if(!result) {
        return callback(new Error('[payswarm.getJsonLd] ' +
          'No JSON-LD found at "' + url + '".'));
      }

      // FIXME: take into consideration response cache info
      // cache JSON-LD
      if(options.cache) {
        return api.cacheJsonLd(url, result, function(err) {
          callback(err, result);
        });
      }
      callback(null, result);
    }
  ], callback);
};

/**
 * HTTP POSTs a JSON-LD object.
 *
 * @param url the URL to HTTP POST to.
 * @param obj the JSON-LD object.
 * @param options: (optional)
 *          request: options for the request. (optional)
 * @param callback(err, result) called once the operation completes.
 */
api.postJsonLd = function(url, obj, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  options.request = options.request || {};

  async.waterfall([
    function(callback) {
      hooks.postJsonLd(url, obj, options.request, callback);
    },
    function(result, callback) {
      try {
        // parse response
        // FIXME move callback outside of try/catch
        callback(null, result);
      }
      catch(ex) {
        callback(new Error('[payswarm.postJsonLd] ' +
          'Invalid response from "' + url +
          '"; malformed JSON - ' + ex.toString() + ': ' +
          JSON.stringify(result, null, 2)));
      }
    }
  ], callback);
};

/**
 * Caches a JSON-LD object if a cache is available.
 *
 * @param id the ID of the JSON-LD object.
 * @param obj the JSON-LD object to cache.
 * @param callback(err) called once the operation completes.
 */
api.cacheJsonLd = function(id, obj, callback) {
  if('cacheJsonLd' in hooks) {
    return hooks.cacheJsonLd(id, obj, 60*5, callback);
  }
  // no cache
  callback();
};

/**
 * Gets a cached JSON-LD object if available.
 *
 * @param id the ID of the JSON-LD object.
 * @param callback(err, result) called once the operation completes.
 */
api.getCachedJsonLd = function(id, callback) {
  if('getCachedJsonLd' in hooks) {
    return hooks.getCachedJsonLd(id, callback);
  }
  callback(null, null);
};

/**
 * Gets a remote public key.
 *
 * @param id the ID for the public key.
 * @param options: (optional)
 *          cache: true to cache the response. [false] (optional)
 *          request: options for the request. (optional)
 * @param callback(err, key) called once the operation completes.
 */
api.getPublicKey = function(id, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  // retrieve public key
  api.getJsonLd(id, options, function(err, key) {
    if(err) {
      return callback(err);
    }

    // FIXME: improve validation
    if(!('publicKeyPem' in key)) {
      return callback(new Error('[payswarm.getPublicKey] ' +
        'Could not get public key. Unknown format.'));
    }
  });
};

/**
 * Creates a nonce for a secure message.
 *
 * @param callback(err, nonce) called once the operation completes.
 */
api.createNonce = function(callback) {
  hooks.createNonce(callback);
};

/**
 * Checks the nonce from a secure message.
 *
 * @param nonce the nonce.
 * @param callback(err, valid) called once the operation completes.
 */
api.checkNonce = function(nonce, callback) {
  hooks.checkNonce(nonce, callback);
};

/**
 * Generates a hash of the JSON-LD encoded data.
 *
 * @param obj the JSON-LD object to hash.
 * @param callback(err, hash) called once the operation completes.
 */
api.hash = function(obj, callback) {
  // SHA-1 hash JSON
  jsonld.normalize(
    obj, {
    format: 'application/nquads'
  }, function(err, result) {
    if(err) {
      return callback(err);
    }
    if(result.length === 0) {
      return callback(new Error('[payswarm.hash] ' +
        'The data to hash is empty. This error may be caused because ' +
        'a "@context" was not supplied in the input which would cause ' +
        'any terms or prefixes to be undefined. ' +
        'Input:\n' + JSON.stringify(obj, null, 2)));
    }

    var md = crypto.createHash('sha256');
    md.update(result, 'utf8');
    callback(null, 'urn:sha256:' + md.digest('hex'));
  });
};

/**
 * Signs a JSON-LD object, adding a signature field to it. If a signature
 * date is not provided then the current date will be used.
 *
 * @param obj the JSON-LD object to sign.
 * @param options the signature options.
 *          [nonce] the nonce to use.
 *          [dateTime] the signature creation dateTime as either a W3C formatted
 *            dateTime or a pure JavaScript date object.
 *          publicKeyId URL to the public key that is associated with the
 *            given private key.
 *          privateKey the private key to use in PEM-encoded format.
 * @param callback(err, signed) called once the operation completes.
 */
api.sign = function(obj, options, callback) {
  var nonce = options.nonce || null;
  var dateTime = options.dateTime || new Date();
  var publicKeyId = options.publicKeyId || null;
  var privateKeyPem = options.privateKeyPem || null;

  // get W3C-formatted date
  if(typeof dateTime !== 'string') {
    dateTime = api.w3cDate(dateTime);
  }

  async.auto({
    normalize: function(callback) {
      jsonld.normalize(
        obj, {
          format: 'application/nquads'
        }, callback);
    },
    sign: ['normalize', function(callback, results) {
      var normalized = results.normalize;
      if(normalized.length === 0) {
        return callback(new Error('[payswarm.sign] ' +
          'The data to sign is empty. This error may be caused because ' +
          'a "@context" was not supplied in the input which would cause ' +
          'any terms or prefixes to be undefined. ' +
          'Input:\n' + JSON.stringify(obj, null, 2)));
      }
      // generate base64-encoded signature
      var signer = crypto.createSign('RSA-SHA256');
      if(nonce !== null) {
        signer.update(nonce);
      }
      signer.update(dateTime);
      signer.update(normalized);
      var signature = signer.sign(privateKeyPem, 'base64');
      callback(null, signature);
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }

    // create signature info
    var signature = {
      type: 'GraphSignature2012',
      creator: publicKeyId,
      created: dateTime,
      signatureValue: results.sign
    };
    if(nonce !== null) {
      signature.nonce = nonce;
    }
    // FIXME: support multiple signatures
    obj.signature = signature;
    callback(null, obj);
  });
};

/**
 * Verifies a JSON-LD digitally-signed object.
 *
 * @param obj the JSON-LD object to verify.
 * @param options: (optional)
 *          request: options for the key request. (optional)
 * @param callback(err) called once the operation completes.
 */
api.verify = function(obj, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  async.auto({
    // FIXME: add support for multiple signatures
    //      : for many signers of an object, can just check all sigs
    //      : for signed sigs, need to recurse?
    // FIXME: add support for different signature types
    //      : frame with signatures to get types, then reframe to get
    //      : correct structure for each type.
    frame: function(callback) {
      // frame message to retrieve signature
      var frame = {
        '@context': api.CONTEXT_URL,
        signature: {
          type: {},
          created: {},
          creator: {},
          signatureValue: {},
          // FIXME: improve handling signatures w/o nonces
          //nonce: {'@omitDefault': true}
        }
      };

      jsonld.frame(obj, frame, function(err, framed) {
        if(err) {
          return callback(err);
        }
        var graphs = framed['@graph'];
        if(graphs.length === 0) {
          return callback(new Error('[payswarm.verify] ' +
            'No signed data found.'));
        }
        if(graphs.length > 1) {
          return callback(new Error('[payswarm.verify] ' +
            'More than one signed graph found.'));
        }
        var graph = graphs[0];
        var signature = graph.signature;
        if(!signature) {
          return callback(new Error('[payswarm.verify] ' +
            'Valid signature not found.'));
        }
        if(signature.type !== 'GraphSignature2012') {
          return callback(new Error('[payswarm.verify] ' +
            'Unknown signature type found.'));
        }
        callback(null, graph);
      });
    },
    checkNonce: ['frame', function(callback, results) {
      var signature = results.frame.signature;
      if('nonce' in signature) {
        return api.checkNonce(signature.nonce, function(err, valid) {
          if(err) {
            return callback(err);
          }
          if(!valid) {
            return callback(new Error('[payswarm.verify] ' +
            'The message nonce is invalid.'));
          }
          callback();
        });
      }
      callback();
    }],
    checkDate: ['frame', function(callback, results) {
      // ensure signature timestamp within a valid range
      var now = +new Date();
      // FIXME: use an option for valid range delta
      var delta = 15 * 60 * 1000; // 15 minutes
      try {
        var signature = results.frame.signature;
        var created = +Date.parse(signature.created);
        if(created < (now - delta) || created > (now + delta)) {
          throw new Error('[payswarm.verify] ' +
            'The message digital signature timestamp is out of range.');
        }
      }
      catch(ex) {
        callback(ex);
      }
    }],
    getPublicKey: ['frame', function(callback, results) {
      var signature = results.frame.signature;
      api.getPublicKey(signature.creator, options, callback);
    }],
    verifyPublicKeyOwner: ['getPublicKey', function(callback, results) {
      var key = results.getPublicKey;
      hooks.isTrustedAuthority(key.owner, function(err, trusted) {
        if(err) {
          return callback(err);
        }
        if(!trusted) {
          return callback(new Error('[payswarm.verify] ' +
          'The message is not signed by a trusted public key.'));
        }
        callback();
      });
    }],
    normalize: ['checkNonce', 'checkDate', 'verifyPublicKeyOwner',
      function(callback, results) {
      // remove signature property from object
      var result = results.frame;
      var signature = result.signature;
      delete result.signature;

      jsonld.normalize(
        result, {
        format: 'application/nquads'
      }, function(err, normalized) {
          if(err) {
            return callback(err);
          }
          callback(null, {data: normalized, signature: signature});
      });
    }],
    verifySignature: ['normalize', function(callback, results) {
      // ensure key has not been revoked
      var key = results.getPublicKey;
      var signature = results.normalize.signature;
      if('revoked' in key) {
        return callback(new Error('[payswarm.verify] ' +
          'The public key has been revoked.'));
      }

      var verifier = crypto.createVerify('RSA-SHA256');
      if('nonce' in signature) {
        verifier.update(signature.nonce);
      }
      verifier.update(signature.created);
      verifier.update(results.normalize.data);
      var verified = verifier.verify(
        key.publicKeyPem, signature.signatureValue, 'base64');
      if(!verified) {
        return callback(new Error('[payswarm.verify] ' +
          'The digital signature on the message is invalid.'));
      }
      callback();
    }]
  }, callback);
};

/**
 * Decrypts an encrypted JSON-LD object.
 *
 * @param encrypted the message to decrypt.
 * @param options the options to use.
 *          privateKey the private key to decrypt with, in PEM-encoded format.
 * @param callback(err, result) called once the operation completes.
 */
api.decrypt = function(encrypted, options, callback) {
  if(encrypted.cipherAlgorithm !== 'rsa-sha256-aes-128-cbc') {
    var algorithm = encrypted.cipherAlgorithm;
    return callback(new Error('[payswarm.decrypt] ' +
      'Unknown encryption algorithm "' + algorithm + '"'));
  }

  try {
    // private key decrypt key and IV
    var pk = ursa.createPrivateKey(options.privateKey, 'utf8');
    var key = pk.decrypt(
      encrypted.cipherKey, 'base64', 'binary',
      ursa.RSA_PKCS1_OAEP_PADDING);
    var iv = pk.decrypt(
      encrypted.initializationVector, 'base64', 'binary',
      ursa.RSA_PKCS1_OAEP_PADDING);

    // symmetric decrypt data
    var decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    var decrypted = decipher.update(encrypted.cipherData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    // return parsed result
    var result = JSON.parse(decrypted);
    callback(null, result);
  }
  catch(ex) {
    callback(new Error('[payswarm.decrypt] ' +
      'Failed to decrypt the encrypted message: ' + ex.toString()));
  }
};

/**
 * Decodes a JSON-encoded, encrypted, digitally-signed message from a
 * PaySwarm Authority.
 *
 * @param msg the json-encoded message to verify.
 * @param options the options to use.
 *          privateKey the private key to decrypt with, in PEM-encoded format.
 * @param callback(err, result) called once the operation completes.
 */
api.decodeAuthorityMessage = function(msg, options, callback) {
  try {
    // convert message from json
    msg = JSON.parse(msg);
  }
  catch(ex) {
    return callback(new Error('[payswarm.decodeAuthorityMessage] ' +
      'The message contains malformed JSON.'));
  }

  // decrypt and verify message
  async.waterfall([
    function(callback) {
      api.decrypt(msg, options, callback);
    },
    function(result, callback) {
      api.verify(result, function(err) {
        if(err) {
          return callback(err);
        }
        callback(null, result);
      });
    }
  ], callback);
};

/**
 * Gets a service config for a PaySwarm Authority.
 *
 * @param host the PaySwarm Authority host and port.
 * @param path path to the config.
 * @param options: (optional)
 *          cache: true to cache the response. [true] (optional)
 *          request: options for the request. (optional)
 * @param callback(err, config) called once the operation completes.
 */
var _getServiceConfig = function(host, path, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  if(!('cache' in options)) {
    options.cache = true;
  }

  // get config
  var url = 'https://' + host + path;
  api.getJsonLd(url, options, callback);
};

/**
 * Gets the service config for a PaySwarm Authority.
 *
 * @param host the PaySwarm Authority host and port.
 * @param options: (optional)
 *          cache: true to cache the response. [true] (optional)
 *          request: options for the request. (optional)
 * @param callback(err, config) called once the operation completes.
 */
api.getAuthorityConfig = function(host, options, callback) {
  return _getServiceConfig(host, '/.well-known/payswarm', options, callback);
  // TODO: validate result
};

/**
 * Gets the service config for a Web Keys endpoint.
 *
 * @param host the Web Keys host and port.
 * @param options: (optional)
 *          cache: true to cache the response. [true] (optional)
 *          request: options for the request. (optional)
 * @param callback(err, config) called once the operation completes.
 */
api.getWebKeysConfig = function(host, options, callback) {
  return _getServiceConfig(host, '/.well-known/web-keys', options, callback);
  // TODO: validate result
};

/**
 * Caches a license at the PaySwarm Authority and returns the result.
 *
 * @param host the PaySwarm Authority host and port.
 * @param id the ID of the license to cache.
 * @param callback(err, result) called once the operation completes.
 */
api.cacheLicenseAtAuthority = function(host, id, callback) {
  async.auto({
    getConfig: function(callback) {
      api.getAuthorityConfig(host, callback);
    },
    sign: function(callback) {
      var msg = {
        '@context': api.CONTEXT_URL,
        license: id
      };
      api.sign(msg, callback);
    },
    post: ['getConfig', 'sign', function(callback, results) {
      var url = results.getConfig.licensesService;
      var msg = results.sign;
      api.postJsonLd(url, msg, callback);
    }],
    checkLicense: ['post', function(callback, results) {
      var license = results.post;
      if(license === null || typeof license !== 'object') {
        return callback(new Error('[payswarm.cacheLicenseAtAuthority] ' +
          'Invalid response when caching license.'));
      }
      // FIXME: use JSON-LD exceptions
      if('message' in license) {
        return callback(new Error('[payswarm.cacheLicenseAtAuthority] ' +
          'Error while caching license: ' + license.message));
      }
      callback(null, license);
    }]
  }, function(err, results) {
    callback(err, results.checkLicense);
  });
};

/**
 * Generates a PEM-encoded key pair and stores it by calling the
 * 'storeKeyPair' hook.
 *
 * @param options the options to use. (optional)
 *          [keySize] the size of the key in bits (default: 2048).
 * @param callback(err, pair) called once the operation completes.
 */
api.createKeyPair = function(options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  var keySize = options.keySize || 2048;
  var keypair = ursa.generatePrivateKey(keySize, 65537);

  // get keys in PEM-format
  var privateKey = keypair.toPrivatePem('utf8');
  var publicKey = keypair.toPublicPem('utf8');

  if(!('storeKeyPair' in hooks)) {
    return callback(null, {privateKey: privateKey, publicKey: publicKey});
  }

  // store key pair
  return hooks.storeKeyPair(publicKey, privateKey, function(err) {
    if(err) {
      return callback(err);
    }
    callback(null, {privateKey: privateKey, publicKey: publicKey});
  });
};

/**
 * Adds a trusted PaySwarm Authority. Only trusted PaySwarm Authorities can
 * be used in financial transactions.
 *
 * @param host the PaySwarm Authority host and port.
 * @param callback(err) called once the operation completes.
 */
api.addTrustedAuthority = function(host, callback) {
  // get authority config
  api.getAuthorityConfig(host, function(err, config) {
    if(err) {
      return callback(err);
    }

    // store authority identity
    var id = config.authorityIdentity;
    hooks.storeTrustedAuthority(id, callback);
  });
};

/**
 * Get the PaySwarm Authority's vendor registration URL, including the
 * parameters required to register the vendor. If a key pair does not exist
 * it will be generated, otherwise the existing key pair will be used unless
 * overwriteKeyPair is set to true.
 *
 * @param host the PaySwarm Authority host and port.
 * @param registrationCallback the registrationCallback to use.
 * @param options the options to use:
 *          overwriteKeyPair true to generate a new key-pair even if
 *            there is an existing one.
 * @param callback(err, url) called once the operation completes.
 */
api.getRegisterVendorUrl = function(
  host, registrationCallback, options, callback) {
  async.auto({
    trustedAuthority: function(callback) {
      // automatically trust given payswarm authority
      api.addTrustedAuthority(host, callback);
    },
    getRegisterUrl: function(callback) {
      // get register URL from authority config
      api.getAuthorityConfig(host, function(err, config) {
        if(err) {
          return callback(err);
        }
        callback(null, config.vendorRegistrationService);
      });
    },
    getPublicKey: function(callback) {
      // use existing public key if overwrite is not specified
      if(!options.overwriteKeyPair) {
        return hooks.getPublicKey(callback);
      }
      // no public key available (or overwriting), generate new key pair
      api.createKeyPair(function(err, pair) {
        if(err) {
          return callback(err);
        }
        callback(null, pair.publicKey);
      });
    },
    createNonce: function(callback) {
      api.createNonce(callback);
    }
  }, function(err, results) {
    if(err) {
      return callback(err);
    }

    // add query parameters to the register URL
    var url = api.addQueryVars(results.getRegisterUrl, {
      'public-key': results.getPublicKey,
      'registration-callback': registrationCallback,
      'response-nonce': results.createNonce
    });
    callback(null, url);
  });
};

/**
 * Completes the vendor registration process by verifying the response
 * from the PaySwarm Authority.
 *
 * @param msg the JSON-encoded encrypted registration response message.
 * @param options the options to use.
 *          privateKey the private key to decrypt with, in PEM-encoded format.
 * @param callback(err, prefs) called once the operation completes.
 */
api.registerVendor = function(msg, options, callback) {
  async.auto({
    decode: function(callback) {
      api.decodeAuthorityMessage(msg, options, callback);
    },
    checkMessage: ['decode', function(callback, results) {
      var prefs = results.decode;
      if(jsonld.hasValue(prefs, 'type', 'Error')) {
        return callback(new Error('[payswarm.registerVendor] ' +
          prefs.errorMessage));
      }
      if(!jsonld.hasValue(prefs, 'type', 'IdentityPreferences')) {
        return callback(new Error('[payswarm.registerVendor] ' +
          'Invalid registration response from PaySwarm Authority.'));
      }
      callback();
    }],
    storePublicKeyId: ['checkMessage', function(callback, results) {
      var prefs = results.decode;
      hooks.storePublicKeyId(prefs.publicKey, callback);
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    callback(null, results.decode);
  });
};

/**
 * Get the PaySwarm Authority's purchase URL, including the parameters
 * identifying the Listing with the Asset to be purchased.
 *
 * @param host the PaySwarm Authority host and port.
 * @param listingId the ID (IRI) for the Listing.
 * @param listingHash the hash for the Listing.
 * @param purchaseCallback the callback URL for the purchase result.
 * @param callback(err, url) called once the operation completes.
 */
api.getPurchaseUrl = function(
  host, listingId, listingHash, purchaseCallback, callback) {
  async.auto({
    getPurchaseUrl: function(callback) {
      // get purchase URL from authority config
      api.getAuthorityConfig(host, function(err, config) {
        if(err) {
          return callback(err);
        }
        callback(null, config.paymentService);
      });
    },
    createNonce: function(callback) {
      api.createNonce(callback);
    }
  }, function(err, results) {
    if(err) {
      return callback(err);
    }

    // add query parameters to the register URL
    var url = api.addQueryVars(results.getPurchaseUrl, {
      listing: listingId,
      'listing-hash': listingHash,
      callback: purchaseCallback,
      'response-nonce': results.createNonce
    });
    callback(null, url);
  });
};

/**
 * Performs an automated purchase on behalf of a customer who has previously
 * authorized it.
 *
 * @param listing the listing object containing the asset to purchase.
 * @param options the options to use.
 *          customer the URL for the identity that is purchasing the asset.
 *          publicKey the URL for the public key associated with the private
 *            key to use to sign the purchase request.
 *          privateKeyPem the private key, in PEM-format, to use to sign
 *            the purchase request.
 *          FIXME: transactionService undocumented -- should this be passed
 *            as an option or retrieved via the customer's PA config?
 *          [source] the URL for the customer's financial account to use to
 *            pay for the asset (this may be omitted if a customer has
 *            previously associated a budget with the vendor that signed
 *            the listing).
 *          [verbose] true if debugging information should be printed to the
 *            console.
 *          [request] options for network requests.
 * @param callback(err, receipt) called once the operation completes.
 */
api.purchase = function(listing, options, callback) {
  // decrypt and verify message
  async.waterfall([
    function(callback) {
      // frame the listing
      jsonld.frame(listing, api.FRAMES.Listing, callback);
    },
    function(framedListing, callback) {
      if(framedListing['@graph'].length === 0) {
        return callback(new Error('[payswarm.purchase] ' +
          'No Listings found.'));
      }
      if(framedListing['@graph'].length > 1) {
        return callback(new Error('[payswarm.purchase] ' +
          'More than one Listing found.'));
      }
      // extract listing from JSON-LD graph and set @context
      listing = framedListing['@graph'][0];
      // FIXME: validate listing
      listing['@context'] = api.CONTEXT_URL;
      callback();
    },
    function(callback) {
      api.hash(listing, function(err, hash) {
        callback(err, hash);
      });
    },
    function(hash, callback) {
      // generate the purchase request
      var purchaseRequest = {
        '@context': api.CONTEXT_URL,
        type: 'PurchaseRequest',
        identity: options.customer,
        listing: listing.id,
        listingHash: hash
      };
      if(options.source) {
        purchaseRequest.source = options.source;
      }

      // sign the purchase request
      api.sign(purchaseRequest, {
        publicKeyId: options.publicKey,
        privateKeyPem: options.privateKeyPem
      }, callback);
    },
    function(signedPurchaseRequest, callback) {
      if(options.verbose) {
        console.log('payswarm.purchase - POSTing purchase request to:',
          JSON.stringify(options.transactionService, null, 2));
        console.log('payswarm.purchase - Purchase Request:',
          JSON.stringify(signedPurchaseRequest, null, 2));
      }
      // post the purchase request to the transaction service
      api.postJsonLd(
        options.transactionService, signedPurchaseRequest,
        {request: options.request}, callback);
    }
  ], callback);
};

/**
 * Completes the purchase process by verifying the response from the PaySwarm
 * Authority and returning the receipt.
 *
 * @param msg the JSON-encoded encrypted purchase response message.
 * @param options the options to use.
 *          privateKey the private key to decrypt with, in PEM-encoded format.
 * @param callback(err, receipt) called once the operation completes.
 */
api.getReceipt = function(msg, options, callback) {
  async.auto({
    decode: function(callback) {
      api.decodeAuthorityMessage(msg, options, callback);
    },
    checkMessage: ['decode', function(callback, results) {
      var receipt = results.decode;
      if(jsonld.hasValue(receipt, 'type', 'Error')) {
        return callback(new Error('[payswarm.getReceipt] ' +
          receipt.errorMessage));
      }
      if(!jsonld.hasValue(receipt, 'type', 'Receipt')) {
        return callback(new Error('[payswarm.getReceipt] ' +
          'Invalid purchase response from PaySwarm Authority.'));
      }
      callback();
    }],
    validate: ['checkMessage', function(callback, results) {
      var receipt = results.decode;
      if(!('contract' in receipt || (typeof receipt.contract !== 'object'))) {
        return callback(new Error('[payswarm.getReceipt] ' +
          'Unknown Receipt format.'));
      }
      var contract = receipt.contract;
      if(!('assetAcquirer' in contract) ||
        !('asset' in contract) ||
        !('license' in contract)) {
        return callback(new Error('[payswarm.getReceipt] ' +
          'Unknown Contract format.'));
      }
      callback();
    }]
  }, function(err, results) {
    if(err) {
      return callback(err);
    }
    callback(null, results.decode);
  });
};

/**
 * Add query variables to an existing url.
 *
 * @param url the url to add the query vars to.
 * @param qvars the query variables to add, eg: {foo: 'bar'}.
 *
 * @return string the updated url.
 */
api.addQueryVars = function(url, qvars) {
  var parsed = URL.parse(url, true);
  for(var key in qvars) {
    parsed.query[key] = qvars[key];
  }
  return URL.format(parsed);
};

/**
 * Determines whether or not the given Listing's validity period has passed.
 *
 * @param listing the Listing to check.
 *
 * @return true if the validity period still applies, false if not.
 */
api.isListingValid = function(listing) {
  try {
    var now = new Date();
    var validFrom = Date.parse(listing.validFrom);
    var validUntil = Date.parse(listing.validUntil);
    return (now >= validFrom && now <= validUntil);
  }
  catch(ex) {
    return false;
  }
};

/**
 * Default GET JSON-LD hook.
 *
 * @param url The URL of the document to retrieve.
 * @param options options for request (optional).
 * @param callback(err, result) called once the operation completes.
 */
api.defaultGetJsonLd = function(url, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }

  jsonld.request(url, options, function(err, res, data) {
    callback(err, data);
  });
};

/**
 * Default POST JSON-LD hook.
 *
 * @param url the URL.
 * @param obj the JSON-LD object.
 * @param options options for request (mutable, optional).
 * @param callback(err, result) called once the operation completes.
 */
api.defaultPostJsonLd = function(url, obj, options, callback) {
  if(typeof options === 'function') {
    callback = options;
    options = {};
  }
  // setup options
  options = options || {};
  options.method = 'POST';
  options.headers = options.headers || {};
  options.headers['Content-Type'] = 'application/ld+json';
  options.body = JSON.stringify(obj);

  jsonld.request(url, options, function(err, res, data) {
    callback(err, data);
  });
};

/**
 * Gets the passed date in W3C format (eg: 2011-03-09T21:55:41Z).
 *
 * @param date the date.
 *
 * @return the date in W3C format.
 */
api.w3cDate = function(date) {
  if(date === undefined || date === null) {
    date = new Date();
  }
  return util.format('%d-%s-%sT%s:%s:%sZ',
    date.getUTCFullYear(),
    _zeroFill2(date.getUTCMonth() + 1),
    _zeroFill2(date.getUTCDate()),
    _zeroFill2(date.getUTCHours()),
    _zeroFill2(date.getUTCMinutes()),
    _zeroFill2(date.getUTCSeconds()));
};

function _zeroFill2(num) {
  return (num < 10) ? '0' + num : '' + num;
}

/** Default GET/POST JSON-LD hooks. */
api.addHook('getJsonLd', api.defaultGetJsonLd);
api.addHook('postJsonLd', api.defaultPostJsonLd);

// JSON-LD document loader
var nodeDocumentLoader = jsonld.documentLoaders.node({secure: true});
api.loadJsonLdDocument = function(url, callback) {
  var context = api.CONTEXTS[url];
  if(context) {
    return callback(null, {
      contextUrl: null,
      document: {'@context': context},
      documentUrl: url
    });
  }
  nodeDocumentLoader(url, callback);
};
jsonld.loadDocument = api.loadJsonLdDocument;

payswarm.js
===========

The [PaySwarm][] Client API enables software to interact with a PaySwarm
Authority. This includes registering public/private keypairs, performing
purchases, depositing money, and withdrawing money into a bank account.

Installation
------------

payswarm.js is available via github and npm:

* github: https://github.com/digitalbazaar/payswarm.js
* npm: https://npmjs.org/package/payswarm

Command Line Tool
-----------------

A tool is included that allows command line access to various PaySwarm
Authority features. For a list of tools and tool help, use the following:

    ./bin/payswarm -h
    ./bin/payswarm {toolname} -h

Most tools require authorization via an access key that is based on a public
and private keypair. This key, the associated authority URL, and other
values are stored in a configuration file. Tools allow you to select the
active config file so you may have multiple keys from a single or many
authorities.

After you have created an identity on an authority you can generate and
register an access key:

    ./bin/payswarm keys -r -a {authority-url}

Without the `-a` option this will default to the sandbox authority. Use the
`-c` option with any tool if you wish to specify a config file other than
`payswarm.cfg`.  Once you have an access key, the tools will use this to
authorize you to an authority.

To list your keys, show a key by id, or show a key by short id:

    ./bin/payswarm keys
    ./bin/payswarm keys https://example.com/i/{my-id}/keys/1
    ./bin/payswarm keys 1

To perform a purchase of a listing (**NOTE**: This performs a real purchase
using a real account!):

    ./bin/payswarm purchase {listing-url}

Developers may be interested in the curl-like tool used to perform
authorized raw REST access on authority URLs. The HTTP method and body data
can be specified. (**NOTE**: This tool performs raw PaySwarm Authority
access without user friendly guidance or confirmations. Be careful!) For
example, to get all of your account details in JSON-LD format:

    ./bin/payswarm url https://example.com/i/{my-id}/accounts

A tool useful for development is the `info` tool. It will print out framed
assets, licenses, listings, and hashes:

    ./bin/payswarm info {listing-url}

The `jsonld` tool from the [jsonld.js][] project can be useful for more
advanced JSON-LD manipulation. To print key details in normalized N-Quads
format:

    ./bin/payswarm keys 1 | jsonld normalize -q

API Introduction
----------------

When writing software intended to act as a PaySwarm Buyer (something that
makes purchases on the Web) or PaySwarm Vendor (something that sells stuff
on the Web), the developer must do the following:

1. Implement application-specific hooks for fetching documents from the Web,
   caching those documents, and storing sensitive data.
2. Create a white-list of all trusted PaySwarm Authorities.
3. Implement the public/private key-pair creation and registration UI.
4. If creating buyer software, implement the software purchasing UI and
   calls to process the purchase via a PaySwarm Authority.
5. If creating vendor software, implement the software sales UI, asset and
   listing creation UI, and all the calls to initiate a purchase via a
   PaySwarm Authority.

Implementing Hooks
------------------

Various hooks will be triggered when making calls to the API. Most of the
hooks involve providing the API with a custom mechanism for doing HTTP
GET/POST and storing/retrieving data from a database.  It is also highly
recommended that the optional cache hooks be implemented to prevent
excessive network traffic when looking up PaySwarm Authority configurations
and public keys. To implement a hook, simply write a function that takes the
appropriate parameters and returns the appropriate values. Then pass the
hook name and the name of the custom function to 'payswarm.addHook'. Look
below for the specific hooks that must be implemented.

Importing the Client
--------------------

At the top of your implementation, require the PaySwarm Client API:

```javascript
var payswarm = require('payswarm-client');
```

Adding Trusted PaySwarm Authorities
-----------------------------------

Add the PaySwarm Authorities that should be trusted by calling:

```javascript
payswarm.addTrustedAuthority('trustedauthority:port');
```

In this version of the API, any PaySwarm Authority that the software will
interact with must be manually added. A vendor's chosen PaySwarm Authority
will be automatically added during the registration step. In the future,
there will be a registry of trusted PaySwarm Authorities.

Performing a Purchase
---------------------


Vendor Registration
-------------------

If you are implementing a website that will operate as a PaySwarm Vendor (a
piece of software that is selling something on the Web), you may register
the vendor by calling:

```javascript
var url = payswarm.getRegisterVendorUrl(
  'myauthority:port',
  'http://myserver/myregistercallbackurl',
  callback);
```

The first parameter is the host and port of the PaySwarm Authority to
register with. The second is a callback URL that will receive the result of
the registration as POST data.

Direct the vendor to the URL so that they can complete the registration
process. Once the registration process is complete, the vendor's browser
will POST the registration result to the callback URL provided.

On the callback page, get the POST value 'encrypted-message' and pass it to
register the vendor:

```javascript
payswarm.registerVendor(req.body['encrypted-message'], callback);
```

If no error is given to the callback, registration is complete. The second
callback parameter is the PaySwarm Vendor's Preferences, including the
Financial Account ID to use in Listings.

Creating Assets and Listings
----------------------------

Create a JSON-LD PaySwarm Asset and Listing. When listing an Asset, its
unique hash must be in the Listing. To generate an asset hash call:

```javascript
payswarm.hash(asset, callback);
```

Sign a listing. Create a JSON-LD PaySwarm Listing and then sign it:

```javascript
payswarm.sign(listing, callback);
```

  Display the listing information; the use of RDFa is recommended. Depending
  on the application's needs, it is sometimes a good idea (or a requirement)
  to regenerate signatures when the vendor's public key is changed.

  Note: A Listing also contains a License for the Asset. If the application
  knows the ID (IRI) of the License to use but not the License hash, and it
  does not have the necessary parser to obtain the License information from
  its ID, it may use the PaySwarm Authority's license service to cache and
  retrieve the License by its ID. Then payswarm.hash(license, callback) can
  be called on the result to produce its hash.

Performing a Vendor-initiated Purchase
--------------------------------------

When a customer indicates that they want to purchase the Asset in a Listing,
call:

```javascript
var url = payswarm.getPurchaseUrl(
  'customersauthority:port',
  listingId,
  listingHash,
  'https://myserver/mypurchasecallbackurl',
  callback);
```

To get a URL to redirect the customer to their PaySwarm Authority to
complete the purchase. The last parameter is a callback URL that will
receive the result of the purchase as POST data.

If the customer has previously completed a purchase and the response
indicated that they set up a budget to handle automated purchases in the
future, then an automated purchase can be attempted by calling:

```javascript
payswarm.purchase(
  'customersauthority:port',
  'https://customersauthority:port/i/customer',
  listingId,
  listingHash,
  callback);
```

In this version of the API, it is the responsibility of the application to
determine the customer's PaySwarm Authority (usually by asking). A listing
hash can be generated by calling:

```javascript
payswarm.hash(listing, callback);
```

To get the JSON-LD receipt from a purchase, call:

```javascript
payswarm.getReceipt(encryptedMessage, callback);
```

Where encryptedMessage is either the result of a POST to the purchase
callback or the result of the `payswarm.purchase()` call.

The receipt will indicate the ID and hash of the Asset purchased as well as
the ID and hash of the License for the Asset.

Authors
-------

This software was written by [Digital Bazaar][] and friends. Please see the
[AUTHORS][] file for full credits.

License
-------

The payswarm.js code, tools, and examples are available under a BSD 3-Clause
License. Please see the [LICENSE][] file for full details.

[PaySwarm]: http://payswarm.com/
[Digital Bazaar]: http://digitalbazaar.com/
[AUTHORS]: AUTHORS
[LICENSE]: LICENSE
[jsonld.js]: https://github.com/digitalbazaar/jsonld.js

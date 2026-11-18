'use strict';

function discountFor(subtotalInCents) {
  return subtotalInCents >= 10000 ? 1000 : 0;
}

module.exports = { discountFor };

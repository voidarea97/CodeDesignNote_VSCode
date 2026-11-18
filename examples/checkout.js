'use strict';

const { discountFor } = require('./discount');

function quote(subtotalInCents) {
  const discount = discountFor(subtotalInCents);
  return { subtotalInCents, discount, total: subtotalInCents - discount };
}

module.exports = { quote };

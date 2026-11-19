import { describe, expect, it } from 'vitest';
import { centsToInput, parseMoneyInput, signedMoney } from './format';
import { estimateFill, maxAffordable } from './orderMath';

const book = {
  asks: [
    { priceCents: 1000, quantity: 5, orders: 1 },
    { priceCents: 1050, quantity: 10, orders: 2 },
  ],
  bids: [
    { priceCents: 990, quantity: 3, orders: 1 },
    { priceCents: 950, quantity: 4, orders: 1 },
  ],
};

describe('estimateFill', () => {
  it('walks asks best-first at resting prices', () => {
    const e = estimateFill('BUY', 8, book);
    expect(e).toMatchObject({ fillableQty: 8, notionalCents: 5 * 1000 + 3 * 1050, worstPriceCents: 1050, shortfallQty: 0, levelsUsed: 2 });
  });
  it('reports shortfall when the book is too thin', () => {
    expect(estimateFill('SELL', 10, book)).toMatchObject({ fillableQty: 7, shortfallQty: 3, notionalCents: 3 * 990 + 4 * 950 });
  });
  it('respects a limit price', () => {
    expect(estimateFill('BUY', 8, book, { limitPriceCents: 1000 })).toMatchObject({ fillableQty: 5, shortfallQty: 3 });
    expect(estimateFill('SELL', 8, book, { limitPriceCents: 960 })).toMatchObject({ fillableQty: 3 });
  });
  it('respects a spending cap like the server budget', () => {
    expect(estimateFill('BUY', 15, book, { maxSpendCents: 7100 })).toMatchObject({ fillableQty: 7, notionalCents: 7100 });
  });
  it('handles an empty or missing book', () => {
    expect(estimateFill('BUY', 3, undefined)).toMatchObject({ fillableQty: 0, shortfallQty: 3, avgPriceCents: null });
  });
  it('maxAffordable buys whole shares within budget', () => {
    expect(maxAffordable(book.asks, 6049)).toBe(5);
    expect(maxAffordable(book.asks, 6050)).toBe(6);
    expect(maxAffordable(book.asks, 999)).toBe(0);
  });
});

describe('money input', () => {
  it('parses dollars to integer cents without floats', () => {
    expect(parseMoneyInput('12')).toBe(1200);
    expect(parseMoneyInput('$12.5')).toBe(1250);
    expect(parseMoneyInput('0.07')).toBe(7);
    expect(parseMoneyInput('1,234.56')).toBe(123456);
    expect(parseMoneyInput('12.345')).toBeNull();
    expect(parseMoneyInput('abc')).toBeNull();
    expect(centsToInput(1250)).toBe('12.50');
    expect(signedMoney(-340)).toBe('-$3.40');
    expect(signedMoney(1200)).toBe('+$12.00');
  });
});

import { Registry } from '@engine/index';

/** A shop is a named list of wares. Prices are in gold (coins = 5g). */
export interface ShopDef {
  name: string;
  wares: { item: string; price: number }[];
}

export const shops = new Registry<ShopDef>('shop');

shops.register('merchant', {
  name: 'ODD WARES',
  wares: [
    { item: 'potion', price: 15 },
    { item: 'haste-draught', price: 20 },
    { item: 'iron-helmet', price: 40 },
    { item: 'hunting-bow', price: 50 },
    { item: 'great-sword', price: 60 },
    { item: 'flintlock', price: 75 },
    { item: 'steel-armor', price: 80 },
  ],
});

/** Importing this module registers the shops. */
export function registerShops(): void {}

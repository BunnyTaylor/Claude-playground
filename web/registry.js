/*
 * registry.js — the catalogue of pattern generators.
 *
 * This is what makes the app a platform: the home page and the studio are both
 * driven by this data, so adding a new pattern in the future is three steps —
 *   1. write a compute<Thing>() in crochet-core.js (returns the standard
 *      { pieces, warnings, meta } shape, with meta.kind),
 *   2. (if it needs new inputs) add an inputs group <div> in index.html and a
 *      viz branch in crochet-viz.js keyed on meta.kind,
 *   3. add an entry below.
 * No other UI wiring required — the switcher, form, preview, counter, yarn,
 * PDF and persistence all read from here.
 *
 * Each generator:
 *   id          unique within its collection
 *   label       short name for the switcher/cards
 *   emoji       card/tab glyph
 *   blurb       one line for the home-page card
 *   compute     name of the CrochetCore function to call
 *   inputGroups ids of the input-group <div>s to show (besides the shared ones)
 *   schematic   whether the "Measurements" preview toggle applies
 */
var Registry = {
  collections: [
    {
      id: "mushroom",
      name: "Amanita Mushroom Set",
      tagline: "A spotted off-shoulder dress with a matching bucket hat, drawstring bag, and mycelium tights — all sized from the same gauge, colours and spots so the set matches.",
      emoji: "🍄",
      generators: [
        { id: "dress", label: "Dress", emoji: "👗", blurb: "Off-shoulder flounce, lantern sleeves, A-line skirt, gill & hem frills.", compute: "computePattern", inputGroups: ["dressInputs"], schematic: true },
        { id: "hat", label: "Hat", emoji: "🎩", blurb: "Mushroom-cap bucket hat: domed spotted crown, flared brim, gill frill.", compute: "computeHat", inputGroups: ["hatInputs"], schematic: false },
        { id: "bag", label: "Bag", emoji: "👜", blurb: "Drawstring bucket bag: round base, spotted sides, eyelets + strap.", compute: "computeBag", inputGroups: ["bagInputs"], schematic: false },
        { id: "tights", label: "Tights", emoji: "🧦", blurb: "Footless tights with an embroidered mycelium web — the roots of your mushroom body.", compute: "computeTights", inputGroups: ["tightsInputs"], schematic: false },
      ],
    },
  ],

  find: function (collectionId, generatorId) {
    var c = this.collections.filter(function (x) { return x.id === collectionId; })[0];
    if (!c) return null;
    var g = c.generators.filter(function (x) { return x.id === generatorId; })[0];
    return g ? { collection: c, generator: g } : null;
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = Registry;

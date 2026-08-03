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
      // Per-collection studio defaults — what makes this set's page its own: its
      // colour palette, the colour-role labels (which garment part each is), and
      // whether the spot controls apply. The studio seeds a fresh project from these
      // and only offers the roles listed here.
      defaults: {
        colorsHeading: "Colours & spots",
        spots: true,
        // Each colour role: the engine key it maps to, its label, an optional default
        // name, and a default hex. The studio renders exactly these — a set only ever
        // has the roles it lists here, nothing is hardcoded.
        colorRoles: [
          { key: "cap", label: "Cap — flounce, sleeves", hex: "#B83A2B" },
          { key: "spot", label: "Spots", hex: "#FCF8EF" },
          { key: "body", label: "Body — skirt, frills", hex: "#F2E4C9" },
        ],
      },
      generators: [
        { id: "dress", label: "Dress", emoji: "👗", blurb: "Off-shoulder flounce, lantern sleeves, A-line skirt, gill & hem frills.", compute: "computePattern", inputGroups: ["dressInputs"], schematic: true },
        { id: "hat", label: "Hat", emoji: "🎩", blurb: "Mushroom-cap bucket hat: domed spotted crown, flared brim, gill frill.", compute: "computeHat", inputGroups: ["hatInputs"], schematic: false },
        { id: "bag", label: "Bag", emoji: "👜", blurb: "Drawstring bucket bag: round base, spotted sides, eyelets + strap.", compute: "computeBag", inputGroups: ["bagInputs"], schematic: false },
        { id: "tights", label: "Tights", emoji: "🧦", blurb: "Footless tights with an embroidered mycelium web — the roots of your mushroom body.", compute: "computeTights", inputGroups: ["tightsInputs"], schematic: false },
      ],
    },
    {
      id: "bat",
      name: "Bat Cloak Set",
      tagline: "A hooded cape whose wide, pointed hem spreads into bat wings when you hold your arms out — with a two-tone eared hood. Sized from your own gauge and wingspan.",
      emoji: "🦇",
      // Its own dark look and just two colour roles (main + accent) — no spots.
      defaults: {
        colorsHeading: "Colours",
        spots: false,
        colorRoles: [
          { key: "body", label: "Main — cloak, wings & hood", name: "black", hex: "#17171b" },
          { key: "cap", label: "Accent — ear inners, ties & loops", name: "crimson", hex: "#8c1622" },
        ],
      },
      generators: [
        { id: "cloak", label: "Cloak", emoji: "🦇", blurb: "Hooded bat cape: shoulder yoke, a flared wing membrane with pointed hem, an eared hood, and thumb loops that pull the drape into wings.", compute: "computeBatCloak", inputGroups: ["batInputs"], schematic: false },
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

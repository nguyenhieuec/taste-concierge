import type { ScriptedAnswers } from "./scripted-ai.ts";

/** Requests a judge is likely to try. The model answers are scripted; every place and score is recorded live. */
/** `unscored` counts model places Qloo finds by name but returns no score for. */
export const SCENARIOS: { id: string; message: string; answers: ScriptedAnswers; unscored?: number }[] = [
  {
    id: "lisbon-restaurants",
    message: "I love Khruangbin and The Grand Budapest Hotel. Where should I eat in Lisbon?",
    answers: {
      plan: {
        seeds: [
          { name: "Khruangbin", kind: "artist" },
          { name: "The Grand Budapest Hotel", kind: "movie" },
        ],
        venue: "restaurant",
        city: "Lisbon",
        country: "Portugal",
      },
      writer: "Your taste runs warm, retro and a little off-beat.",
      modelOnlyNames: ["Time Out Market Lisboa", "Cervejaria Ramiro", "Taberna da Rua das Flores", "A Cevicheria", "Prado"],
    },
  },
  {
    id: "lisbon-bars-less-obvious",
    message: "Same taste, but bars in Lisbon that are not touristy.",
    answers: {
      plan: {
        seeds: [
          { name: "Khruangbin", kind: "artist" },
          { name: "The Grand Budapest Hotel", kind: "movie" },
        ],
        venue: "bar",
        city: "Lisbon",
        country: "Portugal",
        less_obvious: true,
      },
      writer: "Low-key, vinyl-warm and a little theatrical.",
      modelOnlyNames: ["Park Bar", "Pensão Amor", "Foxtrot", "Red Frog Speakeasy", "Cinco Lounge"],
    },
  },
  {
    id: "tokyo-cafes",
    message: "Big fan of Studio Ghibli films and Nick Drake. Find me a cafe in Tokyo.",
    answers: {
      plan: {
        seeds: [
          // Router models send the studio as a brand; Qloo's top brand hit is a photo studio.
          { name: "Studio Ghibli", kind: "brand" },
          { name: "Nick Drake", kind: "artist" },
        ],
        venue: "cafe",
        city: "Tokyo",
        country: "Japan",
      },
      writer: "Quiet, handmade and a little wistful.",
      modelOnlyNames: ["Fuglen Tokyo", "Blue Bottle Coffee Kiyosumi-Shirakawa", "Cafe de l'Ambre", "Bear Pond Espresso", "Omotesando Koffee"],
    },
    unscored: 1,
  },
  {
    id: "lisbon-record-stores",
    message: "I love Khruangbin and The Grand Budapest Hotel. Any record stores in Lisbon?",
    answers: {
      plan: {
        seeds: [
          { name: "Khruangbin", kind: "artist" },
          { name: "The Grand Budapest Hotel", kind: "movie" },
        ],
        venue: "record_store",
        city: "Lisbon",
        country: "Portugal",
      },
      writer: "Crate-digging with a cinematic streak.",
      modelOnlyNames: ["Discolecção", "Flur Discos", "Louie Louie", "Carbono", "Tabatô Records"],
    },
  },
  {
    id: "paris-bookstores-less-obvious",
    message: "I love Amélie and Patti Smith. Bookstores in Paris that are not touristy?",
    answers: {
      plan: {
        seeds: [
          { name: "Amélie", kind: "movie" },
          { name: "Patti Smith", kind: "artist" },
        ],
        venue: "bookstore",
        city: "Paris",
        country: "France",
        less_obvious: true,
      },
      writer: "Romantic, a little bohemian, made for slow afternoons.",
      modelOnlyNames: ["Librairie Les Abeilles", "Le Monte-en-l'air", "L'Écume des Pages", "Librairie Ombres Blanches", "La Belle Lurette"],
    },
  },
];

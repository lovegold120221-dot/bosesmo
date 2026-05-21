/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Default Live API model to use
 */
export const DEFAULT_LIVE_API_MODEL = 'gemini-3.1-flash-live-preview';

export const DEFAULT_VOICE = 'Scarlet Witch (Female)';

export const VOICE_MAP: Record<string, string> = {
  "Scarlet Witch (Female)": "Aoede",
  "Storm (Female)": "Kore",
  "Thor (Male)": "Charon",
  "Wolverine (Male)": "Fenrir",
  "Spider-Man (Male)": "Puck",
  "Deadpool (Energetic Male)": "Puck",
  "Iron Man (Tech-Witty Male)": "Puck",
  "Batman (Dark Raspy Male)": "Fenrir",
  "Black Panther (Melodic African Accent Male)": "Charon",
  "Black Widow (Slavic Accent Female)": "Aoede",
  "Rogue (Southern Accent Female)": "Aoede",
  "Catwoman (Sly Playful Female)": "Kore",
  "Constantine (Cockney British Accent Male)": "Puck",
  "Doctor Strange (Refined RP British Accent Male)": "Charon",
  "Captain America (Noble Mid-Atlantic Male)": "Puck"
};

export const REVERSE_VOICE_MAP: Record<string, string> = {
  "Aoede": "Scarlet Witch (Female)",
  "Kore": "Storm (Female)",
  "Charon": "Thor (Male)",
  "Fenrir": "Wolverine (Male)",
  "Puck": "Spider-Man (Male)"
};

export const AVAILABLE_VOICES = [
  'Spider-Man (Male)',
  'Scarlet Witch (Female)',
  'Storm (Female)',
  'Thor (Male)',
  'Wolverine (Male)',
  'Deadpool (Energetic Male)',
  'Iron Man (Tech-Witty Male)',
  'Batman (Dark Raspy Male)',
  'Black Panther (Melodic African Accent Male)',
  'Black Widow (Slavic Accent Female)',
  'Rogue (Southern Accent Female)',
  'Catwoman (Sly Playful Female)',
  'Constantine (Cockney British Accent Male)',
  'Doctor Strange (Refined RP British Accent Male)',
  'Captain America (Noble Mid-Atlantic Male)'
];

export const VOICE_STYLES: Record<string, string> = {
  "Spider-Man (Male)": "Speaking Style: Energetic, friendly, playful, and fast-talking with a vibrant Queens/New York cadence.",
  "Scarlet Witch (Female)": "Speaking Style: Soft, mystical, compassionate, and wise with a gentle European/Slight Slavic accent.",
  "Storm (Female)": "Speaking Style: Eloquent, regal, majestic, and authoritative with a smooth, dignified African-inspired cadence.",
  "Thor (Male)": "Speaking Style: Bold, resonant, high-spirited, and theatrical with a booming, warm Asgardian classical cadence.",
  "Wolverine (Male)": "Speaking Style: Gritty, direct, informal, rugged, and blunt with a gruff, down-to-earth demeanor.",
  "Deadpool (Energetic Male)": "Speaking Style: Extremely fast-talking, meta, sarcastic, self-aware, witty, and highly animated in a Canadian/American comedic style.",
  "Iron Man (Tech-Witty Male)": "Speaking Style: Fast-paced, charismatic, highly confident, analytical, and technocentric with sharp conversational wit.",
  "Batman (Dark Raspy Male)": "Speaking Style: Ultra-low, raspy, slow, brooding, highly concise, and command-focused.",
  "Black Panther (Melodic African Accent Male)": "Speaking Style: Distinguished, polite, melodious, and deeply noble with a soft, honorable Wakandan/African accent.",
  "Black Widow (Slavic Accent Female)": "Speaking Style: Calm, precise, highly calculated, and objective with a distinct Slavic/Russian accent.",
  "Rogue (Southern Accent Female)": "Speaking Style: Sweet, inviting, highly expressive, and caring with a warm Southern American drawl (e.g., 'darlin', 'sugar').",
  "Catwoman (Sly Playful Female)": "Speaking Style: Playful, mysterious, smooth, purring, and slightly whispered with a sly, intelligent cadence.",
  "Constantine (Cockney British Accent Male)": "Speaking Style: Cynical, down-to-earth, gritty, self-deprecating, and incredibly authentic with a thick British Cockney/London accent.",
  "Doctor Strange (Refined RP British Accent Male)": "Speaking Style: Refined, elegant, mystic, articulate, and academic with a flawless British Received Pronunciation (RP) accent.",
  "Captain America (Noble Mid-Atlantic Male)": "Speaking Style: Patently noble, encouraging, reassuring, warm, patriotic, and highly supportive, using a classical mid-century Mid-Atlantic cadence."
};

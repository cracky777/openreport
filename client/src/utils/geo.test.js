import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizePlace, indexArea, bestArea, findPlace, MAP_AREAS } from './geo';

// The files the map widget fetches, read from disk.
const indexes = Object.fromEntries(MAP_AREAS.map(({ value, file }) => [
  value,
  indexArea(value, JSON.parse(readFileSync(new URL(`../../public/geo/${file}`, import.meta.url), 'utf8'))),
]));

describe('places matched by name', () => {
  test('accents, case, hyphens and "St" do not get in the way', () => {
    expect(normalizePlace("Provence-Alpes-Côte d'Azur")).toBe('provence alpes cote d azur');
    expect(normalizePlace('St-Étienne')).toBe(normalizePlace('Saint-Étienne'));
  });

  test('each column finds its map: regions, départements, countries in French, towns', () => {
    expect(bestArea(['Grand Est', 'Nouvelle-Aquitaine', "Provence-Alpes-Côte d'Azur"], indexes)).toBe('fr-regions');
    expect(bestArea(['Rhône', 'Nord', 'Gironde'], indexes)).toBe('fr-departements');
    expect(bestArea(['Allemagne', 'Royaume-Uni', 'Espagne', 'France'], indexes)).toBe('world');
    expect(bestArea(['Lyon', 'Vénissieux', 'Corbas', 'Nice'], indexes)).toBe('fr-communes');
  });

  test('a town is placed where the most populated of its namesakes is', () => {
    const lyon = indexes['fr-communes'].get(normalizePlace('Lyon'));
    expect(lyon.coord[1]).toBeGreaterThan(45.7);
    expect(lyon.coord[1]).toBeLessThan(45.8);
    expect(indexes.world.get(normalizePlace('DEU'))).toBe('Germany');
  });
});

describe("a base map the instance added (the assistant's add_map card)", () => {
  // Shaped as the server builds it (server/utils/geo/subdivisions.js).
  const states = { type: 'FeatureCollection', features: [
    { properties: { name: 'California', names: ['California', 'Californie', 'CA', 'US-CA'] } },
    { properties: { name: 'Georgia', names: ['Georgia', 'Géorgie', 'GA', 'US-GA'] } },
    { properties: { name: 'Texas', names: ['Texas', 'TX', 'US-TX'] } },
  ] };
  const added = { value: 'admin1-us', label: 'United States of America — states', kind: 'areas' };
  const all = { ...indexes, 'admin1-us': indexArea('admin1-us', states) };

  test('states are drawn on it rather than on the world, codes included', () => {
    expect(bestArea(['California', 'Georgia', 'Texas'], all, [...MAP_AREAS, added])).toBe('admin1-us');
    // CA is Canada on the world map: among state codes it is California.
    expect(bestArea(['CA', 'TX', 'GA'], all, [...MAP_AREAS, added])).toBe('admin1-us');
    // Countries stay on the world.
    expect(bestArea(['Germany', 'Georgia', 'Canada'], all, [...MAP_AREAS, added])).toBe('world');
  });
});

describe("the towns of a country the instance added", () => {
  // Shaped as the server builds them (server/utils/geo/towns.js); Luxembourg's
  // districts alone drew three grey shapes for a column of towns.
  const districts = { type: 'FeatureCollection', features: [
    { properties: { name: 'Luxembourg', names: ['Luxembourg', 'LU-L'] } },
    { properties: { name: 'Diekirch', names: ['Diekirch', 'LU-D'] } },
  ] };
  const towns = { country: 'LU', towns: [
    ['Esch-sur-Alzette', '', 5.98, 49.5, 36625, ['Esch', 'Esch-Uelzecht']],
    ['Luxembourg', '', 6.13, 49.61, 76684, ['Luxembourg City', 'Ville de Luxembourg']],
    ['Wiltz', '', 5.93, 49.97, 7000, []],
    ['Diekirch', '', 6.16, 49.87, 7295, []],
  ] };
  const areas = [...MAP_AREAS,
    { value: 'admin1-lu', label: 'Luxembourg — districts', kind: 'areas' },
    { value: 'towns-lu', label: 'Luxembourg — towns', kind: 'points', base: 'admin1-lu' }];
  const all = { ...indexes, 'admin1-lu': indexArea('admin1-lu', districts, 'areas'), 'towns-lu': indexArea('towns-lu', towns, 'points') };

  test('a column of towns is drawn as bubbles on them, by name or another of their names', () => {
    expect(bestArea(['Esch-sur-Alzette', 'Luxembourg-Ville', 'Wiltz', 'Diekirch'], all, areas)).toBe('towns-lu');
    expect(findPlace(all['towns-lu'], 'Esch').name).toBe('Esch-sur-Alzette');
    expect(findPlace(all['towns-lu'], 'Wiltz').coord).toEqual([5.93, 49.97]);
  });

  test('"Luxembourg-Ville" is the town Luxembourg; a word that is not about the town is not dropped', () => {
    expect(findPlace(all['towns-lu'], 'Luxembourg-Ville').name).toBe('Luxembourg');
    expect(findPlace(all['towns-lu'], 'Ville de Luxembourg').name).toBe('Luxembourg');
    expect(findPlace(all['towns-lu'], 'Wiltz Nord')).toBeUndefined();
  });
});

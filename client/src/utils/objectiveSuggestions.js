// Questions the Assistant panel offers from the catalogue alone, with no call
// to the provider: the objectives of the model's domains whose roles the model
// already carries. Each is phrased as "Objective: its question", so the
// assistant reads which objective is meant and goes straight to the trame.

const MAX_START = 5;
const MAX_FOLLOW = 3;

const rolesOf = (model) => new Set([...(model?.dimensions || []), ...(model?.measures || [])].map((f) => f.role).filter(Boolean));

/** The objectives of the model's domains the model can draw, as [{ domainId, id, text }]. */
function readyObjectives(model, catalogue) {
  const roles = rolesOf(model);
  const out = [];
  for (const id of model?.domains || []) {
    const domain = (catalogue || []).find((d) => d.id === id);
    for (const o of domain?.objectives || []) {
      if (o.needs.every((r) => roles.has(r))) out.push({ domainId: id, id: o.id, text: `${o.label}: ${o.asks.charAt(0).toLowerCase()}${o.asks.slice(1)}` });
    }
  }
  return out;
}

/** What an empty conversation offers on this model; empty when the glossary says nothing yet. */
export function startingQuestions(model, catalogue) {
  return readyObjectives(model, catalogue).slice(0, MAX_START).map((o) => o.text);
}

/** After an answer on one objective: the neighbouring objectives of its domain. */
export function followUps(model, catalogue, understood) {
  const current = understood?.objective?.id;
  const domainId = understood?.domain?.id;
  if (!current || !domainId) return [];
  return readyObjectives(model, catalogue).filter((o) => o.domainId === domainId && o.id !== current).slice(0, MAX_FOLLOW).map((o) => o.text);
}

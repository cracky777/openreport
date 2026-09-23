// Tool definitions handed to the provider, in the neutral shape of
// ./providers. The assistant has one way to read (the rollup cache) and one
// way to answer with a change (a proposal the user must apply). It has no
// tool that writes anything.

const { BINDING_KEYS, DESIGN_CONFIG, TABLE_LOOK } = require('./validateProposal');
const { HARMONIES, HARMONY_NOTES } = require('./colorScheme');
const { TIME_PRESETS, ALL_OPS, MAX_RANK } = require('./widgetShaping');
const { ACTIONS, FREQUENCIES, WEEKDAYS } = require('./actions');

// "header{fontColor,bgColor,…} values{…}": the nested shape of tableConfig, from the validator's own table.
const tableLookShape = Object.entries(TABLE_LOOK).map(([group, keys]) => `${group}{${Object.keys(keys).join(',')}}`).join(' ');

const names = { type: 'array', items: { type: 'string' } };

const QUERY_CACHED_DATA = {
  name: 'query_cached_data',
  description: 'Read aggregated rows from the report\'s cache. Only combinations listed under "Cached data" can be answered; anything else returns a miss. Ask for at least one measure, or for exactly one dimension and no measure to list its distinct values.',
  parameters: {
    type: 'object',
    properties: {
      dimensions: { ...names, maxItems: 4, description: 'Dimension names, copied exactly from the schema' },
      measures: { ...names, maxItems: 6, description: 'Measure names, copied exactly from the schema' },
      filters: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'A dimension name' },
            op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'between'] },
            values: { type: 'array', items: { type: ['string', 'number'] }, description: 'One value for a comparison, two for between, a list for in / not_in' },
          },
          required: ['field', 'op', 'values'],
        },
      },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    required: ['dimensions', 'measures'],
  },
};

const PROPOSE_WIDGETS = {
  name: 'propose_widgets',
  description: 'Propose the visuals that answer the question. The user reviews the proposal and applies it themselves. Call this once, as your final step.',
  parameters: {
    type: 'object',
    properties: {
      reading: {
        type: 'object',
        description: 'Your reading of the request, written BEFORE the visuals, whatever language it is in. The app holds the visuals to it.',
        properties: {
          breakdownBy: { ...names, description: 'Dimension names (copied from the schema) the request asks to see a measure BY, PER or FOR EACH. Each must be on a visual. Empty when it asks for a total.' },
          ranking: {
            type: 'object',
            description: 'Only when the request asks for the N biggest or smallest',
            properties: {
              n: { type: 'integer', minimum: 1, maximum: MAX_RANK },
              direction: { type: 'string', enum: ['top', 'bottom'], description: 'top: the biggest, most, best · bottom: the smallest, fewest, worst' },
              by: { type: 'string', description: 'The measure they are ranked by' },
            },
            required: ['n', 'direction'],
          },
          sameMembersAsBefore: { type: 'boolean', description: 'true when the request is about the members of the ranking your previous answer showed ("among these…")' },
        },
      },
      widgets: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: Object.keys(BINDING_KEYS) },
            subType: { type: 'string', description: 'bar: grouped|stacked|stacked100 · line: line|area|stackedArea|stackedArea100 · combo: stackedCombo|clusteredCombo · gauge: arc|column' },
            title: { type: 'string' },
            answers: {
              type: 'string',
              enum: ['figure', 'target', 'comparison', 'ranking', 'trend', 'share', 'crossed', 'relationship', 'distribution', 'detail', 'control'],
              description: 'The kind of question this visual answers — decide it first, then pick the type. figure: one number · target: a number against a goal · comparison: a measure across categories · ranking: the biggest or smallest · trend: change over time · share: parts of a whole · crossed: two dimensions read together · relationship: two measures against each other · distribution: how values spread · detail: exact values to look up · control: let the reader narrow the page',
            },
            topN: { type: 'integer', minimum: 1, maximum: MAX_RANK, description: 'Keep the N highest values of the first measure ("top 5 regions" → 5). Needs a dimension and a measure; works on bar, pie, treemap, table, line…' },
            bottomN: { type: 'integer', minimum: 1, maximum: MAX_RANK, description: 'Same, the N lowest ("the 5 worst")' },
            rankBy: { type: 'string', description: 'The measure topN / bottomN ranks by, when it is not the first measure shown — it need not be on the visual. "Among the top 5 clients by calls, which one has the most cancellations": rankBy = the calls measure, topN 5, selectedMeasures = the cancellations measure.' },
            filters: {
              type: 'array',
              maxItems: 6,
              description: 'Filters of THIS visual, when the question restricts the data ("in 2023", "for France", "regions above 1M inhabitants"). A filter on a measure keeps the rows whose aggregated value passes.',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', description: 'A dimension or a measure name, copied exactly from the schema' },
                  op: { type: 'string', enum: ALL_OPS, description: 'text dimension: in, not_in, contains, not_contains, starts_with, ends_with, is_empty, is_not_empty · date dimension: between, gte, lte · number dimension: in, not_in, gt, gte, lt, lte, between · measure: gt, gte, lt, lte, between' },
                  values: { type: 'array', items: { type: ['string', 'number'] }, description: 'One value; two for between; a list for in / not_in; none for is_empty. Dates are YYYY-MM-DD.' },
                },
                required: ['field', 'op'],
              },
            },
            timePeriod: {
              type: 'object',
              description: 'A rolling period that follows today ("this year", "last 30 days"), rather than fixed dates',
              properties: { dim: { type: 'string', description: 'A date dimension' }, preset: { type: 'string', enum: TIME_PRESETS } },
              required: ['dim', 'preset'],
            },
            drill: { type: 'boolean', description: 'true ONLY when the user asks to drill down (e.g. region, then its cities on click): several dimensions in selectedDimensions are then kept as levels. Otherwise a second axis dimension is moved to the legend.' },
            sort: { type: 'string', enum: ['asc', 'desc'], description: 'Order the categories by value (bar, pie, treemap). A top / bottom N is sorted already.' },
            limit: { type: 'integer', minimum: 1, maximum: 10000, description: 'table, pivotTable: maximum number of rows' },
            binding: {
              type: 'object',
              description: 'Field names copied exactly from the schema',
              properties: {
                selectedDimensions: { ...names, description: 'Axis / category / rows / table columns / the filter field. On a chart, ONE dimension: a second one there is a drill-down level the reader only sees by clicking (see drill)' },
                groupBy: { ...names, description: 'Legend (bar, line, combo, scatter): the second dimension shown AT ONCE, as colors — stacked or grouped bars' },
                columnDimensions: { ...names, description: 'Pivot columns (pivotTable)' },
                selectedMeasures: { ...names, description: 'Values' },
                comboBarMeasures: names,
                comboLineMeasures: names,
                scatterMeasures: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'string' }, size: { type: 'string' } } },
                compareDateDim: { type: 'string', description: 'scorecard: date dimension for the previous-period comparison' },
                gaugeMaxMeasure: { type: 'string' },
                gaugeThresholdMeasure: { type: 'string' },
              },
            },
            layout: {
              type: 'object',
              description: 'Position and size in page pixels. Omit to let the editor place the widget.',
              properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
            },
            rationale: { type: 'string', description: 'One short sentence (15 words at most): why this visual answers the question' },
          },
          required: ['type', 'answers', 'title', 'binding', 'rationale'],
        },
      },
    },
    required: ['reading', 'widgets'],
  },
};

const PROPOSE_DESIGN_CHANGES = {
  name: 'propose_design_changes',
  description: 'Propose changes to the look and layout of the current page: restyle widgets, move or resize them, change their stacking, or change the report theme and page background. It cannot change what data a widget shows. The user reviews the proposal and applies it themselves. Call this once, as your final step.',
  parameters: {
    type: 'object',
    properties: {
      reading: {
        type: 'object',
        description: 'What the user asked to change, read from the request BEFORE anything else, whatever language it is in. Only what it allows is applied.',
        properties: {
          layout: { type: 'boolean', description: 'Move, resize or rearrange the page — or improve / redesign / clean up the page as a whole' },
          colors: { type: 'boolean', description: 'Recolor the series or the page as a whole — or improve / redesign it as a whole. Not the color of one kind of element (legend text, titles, table header): that is a targeted change in ops' },
          theme: { type: 'boolean', description: 'Switch the report theme (dark, light…) or change the page background' },
        },
        required: ['layout', 'colors', 'theme'],
      },
      summary: { type: 'string', description: 'One sentence (25 words at most): what changes and how it serves the business question' },
      arrangement: {
        type: 'object',
        description: 'The layout of the page, as rows from top to bottom. THE way to move and resize: you decide the order, what shares a row and what matters most; the editor computes exact pixels, margins, gutters, grid alignment and keeps every widget readable. Put every widget of the page in it, except members of a merged block.',
        properties: {
          rows: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: {
              type: 'object',
              properties: {
                height: { type: 'number', description: 'Relative height of the row: 1 for a row of scorecards or filters, 3 for the row of the main chart, 2 for secondary charts or tables' },
                widgets: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 8,
                  items: { type: 'string' },
                  description: 'Left to right, by widget id: ["w3", "w4"]. Append ":2" to make one twice as wide as its neighbours: ["w7:2", "w8"]',
                },
              },
              required: ['widgets'],
            },
          },
        },
        required: ['rows'],
      },
      colorScheme: {
        type: 'string',
        enum: Object.keys(HARMONIES),
        description: `THE way to color a page. Name the rule by which the hues of a set of categories are chosen; the editor computes the colors from \`baseColor\` and applies them to every widget by fixed rules, so you never write a series color yourself. ${Object.entries(HARMONY_NOTES).map(([k, v]) => `${k}: ${v}`).join('; ')}.`,
      },
      baseColor: {
        type: 'string',
        description: 'The color the page is built on, as #rrggbb: the brand color or the hue the user asked for ("make it green" → a green). Omit to keep the editor\'s own blue.',
      },
      advice: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string' },
        description: 'Usually omitted. A real problem only the user can fix: two visuals showing exactly the same thing, a chart type that misleads — and removing or moving visuals ONLY when "Page load" says TOO MANY or the arrangement was refused for lack of room. One short sentence each, in the language of the user.',
      },
      ops: {
        type: 'array',
        maxItems: 40,
        description: 'Restyles and other changes. Use op "move" only for a single small adjustment; for a layout use `arrangement`.',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['update_config', 'move', 'z_order', 'report_settings'] },
            widgetId: { type: 'string', description: 'A widget id from "Widgets already on the page", such as "w3" (not for report_settings)' },
            set: {
              type: 'object',
              description: `update_config: any of ${Object.keys(DESIGN_CONFIG).join(', ')} — colors are #rrggbb, legendColors maps a series name to a color, tableConfig (table, pivotTable) is an object of ${tableLookShape} merged into the current one. report_settings: theme (a key from "Themes") and/or pageBackground (#rrggbb).`,
            },
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
            to: { type: 'string', enum: ['front', 'back'] },
          },
          required: ['op'],
        },
      },
    },
    required: ['reading', 'summary'],
  },
};

/**
 * `propose_widgets` as this conversation may use it.
 * - `library`: the custom visuals installed in the workspace. When there are
 *   any, `customVisual` joins the types and `visualId` names one of them — an
 *   enum, so the model picks from what exists instead of inventing an id.
 * - `withLayout: false` for a conversation that has no page (the landing-page
 *   assistant): there is nothing to position a visual against, and a model
 *   handed the field fills it with coordinates made up for a page it cannot
 *   see. Sizes and places are computed afterwards (arrangeLayout.layoutNew).
 */
function widgetsToolFor({ library = [], withLayout = true, hasDate = true } = {}) {
  const base = PROPOSE_WIDGETS.parameters.properties.widgets.items;
  const { layout, ...rest } = base.properties;
  const properties = withLayout ? { ...rest, layout } : { ...rest };
  // A model with no date dimension has no time to show anything over: the
  // model is not offered a trend, nor a rolling period.
  if (!hasDate) {
    properties.answers = { ...properties.answers, enum: properties.answers.enum.filter((k) => k !== 'trend') };
    delete properties.timePeriod;
  }
  if (library.length) {
    properties.type = { ...properties.type, enum: [...properties.type.enum, 'customVisual'] };
    properties.visualId = {
      type: 'string',
      enum: library.map((v) => v.id),
      description: 'type customVisual only: which visual of the workspace library (see "Workspace library"). Bind its dimensions and measures in selectedDimensions / selectedMeasures.',
    };
  }
  const items = { ...base, properties };
  return {
    ...PROPOSE_WIDGETS,
    parameters: { ...PROPOSE_WIDGETS.parameters, properties: { widgets: { ...PROPOSE_WIDGETS.parameters.properties.widgets, items } } },
  };
}

const PROPOSE_CUSTOM_VISUAL = {
  name: 'propose_custom_visual',
  description: 'Write a brand-new visual, when no built-in widget type draws what the question calls for or when the user asks for a new kind of visual (see "Writing a custom visual"). The workspace admin reviews the code, previews it, and adds it to the workspace library themselves. Call this once, as your final step.',
  parameters: {
    type: 'object',
    properties: {
      manifest: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'lowercase slug, e.g. "radial-progress"' },
          name: { type: 'string' },
          description: { type: 'string' },
          dataSchema: {
            type: 'object',
            properties: {
              dimensions: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, label: { type: 'string' } } } },
              measures: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, label: { type: 'string' } } } },
            },
            required: ['dimensions', 'measures'],
          },
          configSchema: {
            type: 'array',
            description: 'Options shown in the editor. type: boolean | number | color | string | select (select needs options: [{value, label}]).',
            items: { type: 'object' },
          },
        },
        required: ['name', 'dataSchema'],
      },
      visualJs: { type: 'string', description: 'The complete source of visual.js' },
      binding: {
        type: 'object',
        description: 'The fields to bind on insertion, names copied exactly from the schema',
        properties: { selectedDimensions: names, selectedMeasures: names },
      },
      layout: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
      rationale: { type: 'string', description: 'One sentence (25 words at most): why no built-in widget type fits, and what this visual shows' },
    },
    required: ['manifest', 'visualJs', 'binding', 'rationale'],
  },
};

/**
 * `read_help`: sections of the user guide (help.md), by id — a closed list,
 * so the model picks among what exists.
 */
function helpToolFor(topics) {
  return {
    name: 'read_help',
    description: 'Read sections of the OpenReport user guide, to answer a question about how to use OpenReport itself (where to click, how to schedule, share, export, set up a model…). Answer from what it returns only.',
    parameters: {
      type: 'object',
      properties: {
        topics: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string', enum: topics.map((t) => t.id) }, description: 'The sections that cover the question' },
      },
      required: ['topics'],
    },
  };
}

// Doing something for the user instead of explaining how: a card they confirm.
const PROPOSE_ACTION = {
  name: 'propose_action',
  description: 'Do something in OpenReport for the user, when they ask you to do it (not when they ask how it is done): they see a card and confirm it with one click. schedule_cache_refresh: refresh the cache of a report on a schedule — what scheduling a report means in this edition. open_model_assistant: the user wants the data model itself changed (joins, dimension / measure flags, model measures, fact / dimension tables, the diagram), which only the model assistant of the model editor does — the card opens it. Call this once, as your final step.',
  parameters: {
    type: 'object',
    properties: {
      userAsked: { type: 'string', enum: ['do', 'how'], description: 'do: the user asks you to do it ("schedule my report every Monday", "yes, do it") · how: the user asks how it is done ("how do I schedule a report?") — then do NOT call this tool: explain' },
      action: { type: 'string', enum: ACTIONS },
      frequency: { type: 'string', enum: FREQUENCIES, description: 'schedule_cache_refresh only' },
      weekday: { type: 'string', enum: WEEKDAYS, description: 'weekly only' },
      monthDay: { type: 'integer', minimum: 1, maximum: 28, description: 'monthly only' },
      time: { type: 'string', description: 'HH:MM, 24-hour clock, in the user\'s time zone (08:00 when they do not say)' },
      request: { type: 'string', description: 'open_model_assistant only: the user\'s request, in their language, as they would type it to the model assistant' },
      summary: { type: 'string', description: 'One short sentence in the user\'s language: what will happen' },
    },
    required: ['userAsked', 'action', 'summary'],
  },
};

// The model editor's assistant (modelAssistant.js). Names only; no SQL.
const PROPOSE_MODEL_CHANGES = {
  name: 'propose_model_changes',
  description: 'Propose changes to the data model: joins, dimension / measure flags, measures, fact / dimension tables, and arranging the diagram. The author applies them and saves. Call this once, as your final step.',
  parameters: {
    type: 'object',
    properties: {
      reading: {
        type: 'object',
        description: 'What the request asks to change, read BEFORE anything else, whatever its language. Only those parts are applied.',
        properties: {
          joins: { type: 'boolean' },
          fields: { type: 'boolean', description: 'which columns are dimensions or measures' },
          measures: { type: 'boolean', description: 'new measures (aggregations)' },
          tableRoles: { type: 'boolean', description: 'which tables are facts or dimensions' },
          layout: { type: 'boolean', description: 'arrange the tables on the diagram' },
        },
        required: ['joins', 'fields', 'measures', 'tableRoles', 'layout'],
      },
      summary: { type: 'string', description: 'One sentence in the user\'s language: what changes' },
      joins: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fromTable: { type: 'string' }, fromColumn: { type: 'string' },
            toTable: { type: 'string' }, toColumn: { type: 'string' },
            cardinality: { type: 'string', enum: ['many-to-one', 'one-to-many', 'one-to-one', 'many-to-many'] },
          },
          required: ['fromTable', 'fromColumn', 'toTable', 'toColumn', 'cardinality'],
        },
      },
      removeJoins: {
        type: 'array',
        items: { type: 'object', properties: { fromTable: { type: 'string' }, fromColumn: { type: 'string' }, toTable: { type: 'string' }, toColumn: { type: 'string' } }, required: ['fromTable', 'fromColumn', 'toTable', 'toColumn'] },
      },
      tableRoles: {
        type: 'array',
        items: { type: 'object', properties: { table: { type: 'string' }, role: { type: 'string', enum: ['fact', 'dimension'] } }, required: ['table', 'role'] },
      },
      fields: {
        type: 'array',
        items: { type: 'object', properties: { table: { type: 'string' }, column: { type: 'string' }, as: { type: 'string', enum: ['dimension', 'measure', 'none'] } }, required: ['table', 'column', 'as'] },
      },
      measures: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            table: { type: 'string' },
            column: { type: 'string', description: 'A column name; for a number of rows, count on the key column of the table' },
            aggregation: { type: 'string', enum: ['sum', 'avg', 'count', 'count_distinct', 'min', 'max'] },
            label: { type: 'string' },
          },
          required: ['table', 'column', 'aggregation'],
        },
      },
    },
    required: ['reading', 'summary'],
  },
};

const PING = {
  name: 'ping',
  description: 'Connectivity check. Call it once with ok=true.',
  parameters: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
};

module.exports = { QUERY_CACHED_DATA, PROPOSE_WIDGETS, PROPOSE_DESIGN_CHANGES, PROPOSE_CUSTOM_VISUAL, PROPOSE_ACTION, PROPOSE_MODEL_CHANGES, PING, widgetsToolFor, helpToolFor };

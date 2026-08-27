/* eslint-disable */
/**
 * Generated from the normative DSTAR 0.1 JSON Schemas.
 * Do not edit by hand; run `pnpm generate:schema-types`.
 */

export const SCHEMA_DOCUMENTS = {
  "annotation": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://dstar.dev/spec/0.1/schemas/annotation.schema.json",
    "title": "DSTAR 0.1 Annotation Thread",
    "type": "object",
    "required": [
      "id",
      "type",
      "purpose",
      "scope",
      "target",
      "body",
      "author",
      "status",
      "createdAt"
    ],
    "properties": {
      "id": {
        "$ref": "#/$defs/id"
      },
      "type": {
        "type": "string",
        "minLength": 1
      },
      "purpose": {
        "enum": [
          "discussion",
          "question",
          "change-request"
        ]
      },
      "scope": {
        "enum": [
          "canonical",
          "projection",
          "both"
        ]
      },
      "target": {
        "$ref": "#/$defs/target"
      },
      "canonicalTargets": {
        "type": "array",
        "minItems": 1,
        "items": {
          "$ref": "#/$defs/canonicalTarget"
        }
      },
      "body": {
        "type": "string",
        "minLength": 1
      },
      "author": {
        "$ref": "#/$defs/actor"
      },
      "assignee": {
        "$ref": "#/$defs/humanActor"
      },
      "replies": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/reply"
        }
      },
      "audience": {
        "type": "array",
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "enum": [
            "human",
            "service"
          ]
        }
      },
      "status": {
        "enum": [
          "open",
          "resolved"
        ]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "resolvedAt": {
        "type": "string",
        "format": "date-time"
      },
      "resolvedBy": {
        "$ref": "#/$defs/humanActor"
      }
    },
    "patternProperties": {
      "^x-": true
    },
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "target": {
              "properties": {
                "source": {
                  "const": "document"
                }
              },
              "required": [
                "source"
              ]
            }
          },
          "required": [
            "target"
          ]
        },
        "then": {
          "properties": {
            "scope": {
              "const": "canonical"
            }
          }
        },
        "else": {
          "required": [
            "canonicalTargets"
          ]
        }
      },
      {
        "if": {
          "properties": {
            "status": {
              "const": "resolved"
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "resolvedAt",
            "resolvedBy"
          ]
        },
        "else": {
          "not": {
            "anyOf": [
              {
                "required": [
                  "resolvedAt"
                ]
              },
              {
                "required": [
                  "resolvedBy"
                ]
              }
            ]
          }
        }
      }
    ],
    "$defs": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255,
        "pattern": "^[A-Za-z][A-Za-z0-9._:-]*$"
      },
      "revision": {
        "type": "string",
        "pattern": "^sha256:[0-9a-f]{64}$"
      },
      "actor": {
        "type": "object",
        "required": [
          "type",
          "id"
        ],
        "properties": {
          "type": {
            "enum": [
              "human",
              "service"
            ]
          },
          "id": {
            "$ref": "#/$defs/id"
          },
          "name": {
            "type": "string"
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false
      },
      "humanActor": {
        "allOf": [
          {
            "$ref": "#/$defs/actor"
          },
          {
            "properties": {
              "type": {
                "const": "human"
              }
            },
            "required": [
              "type"
            ]
          }
        ]
      },
      "textPositionSelector": {
        "type": "object",
        "required": [
          "type",
          "start",
          "end",
          "unit"
        ],
        "properties": {
          "type": {
            "const": "TextPositionSelector"
          },
          "start": {
            "type": "integer",
            "minimum": 0
          },
          "end": {
            "type": "integer",
            "minimum": 0
          },
          "unit": {
            "const": "unicode-code-point"
          }
        },
        "additionalProperties": false
      },
      "textQuoteSelector": {
        "type": "object",
        "required": [
          "type",
          "exact"
        ],
        "properties": {
          "type": {
            "const": "TextQuoteSelector"
          },
          "exact": {
            "type": "string",
            "minLength": 1
          },
          "prefix": {
            "type": "string"
          },
          "suffix": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "refinedSelector": {
        "oneOf": [
          {
            "$ref": "#/$defs/textPositionSelector"
          },
          {
            "$ref": "#/$defs/textQuoteSelector"
          }
        ]
      },
      "nodeSelector": {
        "type": "object",
        "required": [
          "type",
          "node"
        ],
        "properties": {
          "type": {
            "const": "NodeSelector"
          },
          "node": {
            "$ref": "#/$defs/id"
          },
          "refinedBy": {
            "type": "array",
            "minItems": 1,
            "maxItems": 2,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/refinedSelector"
            }
          }
        },
        "additionalProperties": false
      },
      "nodePoint": {
        "type": "object",
        "required": [
          "node",
          "offset"
        ],
        "properties": {
          "node": {
            "$ref": "#/$defs/id"
          },
          "offset": {
            "type": "integer",
            "minimum": 0
          }
        },
        "additionalProperties": false
      },
      "nodeRangeSelector": {
        "type": "object",
        "required": [
          "type",
          "start",
          "end",
          "unit",
          "exact"
        ],
        "properties": {
          "type": {
            "const": "NodeRangeSelector"
          },
          "start": {
            "$ref": "#/$defs/nodePoint"
          },
          "end": {
            "$ref": "#/$defs/nodePoint"
          },
          "unit": {
            "const": "unicode-code-point"
          },
          "exact": {
            "type": "string",
            "minLength": 1
          },
          "viewExact": {
            "type": "string",
            "minLength": 1
          },
          "prefix": {
            "type": "string"
          },
          "suffix": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "segmentSelector": {
        "type": "object",
        "required": [
          "type",
          "segment"
        ],
        "properties": {
          "type": {
            "const": "SegmentSelector"
          },
          "segment": {
            "$ref": "#/$defs/id"
          },
          "refinedBy": {
            "type": "array",
            "minItems": 1,
            "maxItems": 2,
            "uniqueItems": true,
            "items": {
              "$ref": "#/$defs/refinedSelector"
            }
          }
        },
        "additionalProperties": false
      },
      "segmentPoint": {
        "type": "object",
        "required": [
          "segment",
          "offset"
        ],
        "properties": {
          "segment": {
            "$ref": "#/$defs/id"
          },
          "offset": {
            "type": "integer",
            "minimum": 0
          }
        },
        "additionalProperties": false
      },
      "segmentRangeSelector": {
        "type": "object",
        "required": [
          "type",
          "start",
          "end",
          "unit",
          "exact"
        ],
        "properties": {
          "type": {
            "const": "SegmentRangeSelector"
          },
          "start": {
            "$ref": "#/$defs/segmentPoint"
          },
          "end": {
            "$ref": "#/$defs/segmentPoint"
          },
          "unit": {
            "const": "unicode-code-point"
          },
          "exact": {
            "type": "string",
            "minLength": 1
          },
          "prefix": {
            "type": "string"
          },
          "suffix": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "target": {
        "type": "object",
        "required": [
          "source",
          "revision",
          "selector"
        ],
        "properties": {
          "source": {
            "$ref": "#/$defs/id"
          },
          "revision": {
            "$ref": "#/$defs/revision"
          },
          "selector": {
            "oneOf": [
              {
                "$ref": "#/$defs/nodeSelector"
              },
              {
                "$ref": "#/$defs/nodeRangeSelector"
              },
              {
                "$ref": "#/$defs/segmentSelector"
              },
              {
                "$ref": "#/$defs/segmentRangeSelector"
              }
            ]
          }
        },
        "additionalProperties": false,
        "allOf": [
          {
            "if": {
              "properties": {
                "source": {
                  "const": "document"
                }
              },
              "required": [
                "source"
              ]
            },
            "then": {
              "properties": {
                "selector": {
                  "oneOf": [
                    {
                      "$ref": "#/$defs/nodeSelector"
                    },
                    {
                      "$ref": "#/$defs/nodeRangeSelector"
                    }
                  ]
                }
              }
            },
            "else": {
              "properties": {
                "selector": {
                  "oneOf": [
                    {
                      "$ref": "#/$defs/segmentSelector"
                    },
                    {
                      "$ref": "#/$defs/segmentRangeSelector"
                    }
                  ]
                }
              }
            }
          }
        ]
      },
      "canonicalTarget": {
        "type": "object",
        "required": [
          "relation",
          "source",
          "revision",
          "selector"
        ],
        "properties": {
          "relation": {
            "enum": [
              "exact",
              "transformed",
              "summarizes"
            ]
          },
          "source": {
            "const": "document"
          },
          "revision": {
            "$ref": "#/$defs/revision"
          },
          "selector": {
            "oneOf": [
              {
                "$ref": "#/$defs/nodeSelector"
              },
              {
                "$ref": "#/$defs/nodeRangeSelector"
              }
            ]
          }
        },
        "additionalProperties": false
      },
      "reply": {
        "type": "object",
        "required": [
          "id",
          "body",
          "author",
          "createdAt"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "body": {
            "type": "string",
            "minLength": 1
          },
          "author": {
            "$ref": "#/$defs/actor"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false
      }
    }
  },
  "change": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://dstar.dev/spec/0.1/schemas/change.schema.json",
    "title": "DSTAR 0.1 Change",
    "type": "object",
    "required": [
      "id",
      "kind",
      "idempotencyKey",
      "author",
      "operations",
      "status",
      "createdAt"
    ],
    "properties": {
      "id": {
        "$ref": "#/$defs/id"
      },
      "kind": {
        "enum": [
          "genesis",
          "update"
        ]
      },
      "idempotencyKey": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255
      },
      "baseChange": {
        "$ref": "#/$defs/id"
      },
      "baseRevision": {
        "$ref": "#/$defs/revision"
      },
      "author": {
        "$ref": "#/$defs/actor"
      },
      "request": {
        "$ref": "#/$defs/request"
      },
      "operations": {
        "type": "array",
        "minItems": 1,
        "items": {
          "oneOf": [
            {
              "$ref": "#/$defs/createDocumentOperation"
            },
            {
              "$ref": "#/$defs/updateOperation"
            }
          ]
        }
      },
      "status": {
        "enum": [
          "proposed",
          "accepted",
          "rejected",
          "superseded"
        ]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "motivatedBy": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/id"
        },
        "uniqueItems": true
      },
      "sources": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/id"
        },
        "uniqueItems": true
      },
      "decision": {
        "$ref": "#/$defs/decision"
      }
    },
    "patternProperties": {
      "^x-": true
    },
    "additionalProperties": false,
    "allOf": [
      {
        "if": {
          "properties": {
            "status": {
              "const": "proposed"
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "not": {
            "required": [
              "decision"
            ]
          }
        }
      },
      {
        "if": {
          "properties": {
            "status": {
              "const": "accepted"
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "decision"
          ],
          "properties": {
            "decision": {
              "required": [
                "resultRevision"
              ],
              "properties": {
                "status": {
                  "const": "accepted"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "status": {
              "const": "rejected"
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "decision"
          ],
          "properties": {
            "decision": {
              "not": {
                "required": [
                  "resultRevision"
                ]
              },
              "properties": {
                "status": {
                  "const": "rejected"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "status": {
              "const": "superseded"
            }
          },
          "required": [
            "status"
          ]
        },
        "then": {
          "required": [
            "decision"
          ],
          "properties": {
            "decision": {
              "not": {
                "required": [
                  "resultRevision"
                ]
              },
              "properties": {
                "status": {
                  "const": "superseded"
                }
              }
            }
          }
        }
      },
      {
        "if": {
          "properties": {
            "kind": {
              "const": "genesis"
            }
          },
          "required": [
            "kind"
          ]
        },
        "then": {
          "required": [
            "request"
          ],
          "not": {
            "anyOf": [
              {
                "required": [
                  "baseChange"
                ]
              },
              {
                "required": [
                  "baseRevision"
                ]
              }
            ]
          },
          "properties": {
            "operations": {
              "minItems": 1,
              "maxItems": 1,
              "items": {
                "$ref": "#/$defs/createDocumentOperation"
              }
            }
          }
        },
        "else": {
          "required": [
            "baseChange",
            "baseRevision"
          ],
          "properties": {
            "operations": {
              "items": {
                "$ref": "#/$defs/updateOperation"
              }
            }
          }
        }
      }
    ],
    "$defs": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255,
        "pattern": "^[A-Za-z][A-Za-z0-9._:-]*$"
      },
      "revision": {
        "type": "string",
        "pattern": "^sha256:[0-9a-f]{64}$"
      },
      "actor": {
        "type": "object",
        "required": [
          "type",
          "id"
        ],
        "properties": {
          "type": {
            "enum": [
              "human",
              "service"
            ]
          },
          "id": {
            "$ref": "#/$defs/id"
          },
          "name": {
            "type": "string"
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false
      },
      "humanActor": {
        "allOf": [
          {
            "$ref": "#/$defs/actor"
          },
          {
            "properties": {
              "type": {
                "const": "human"
              }
            },
            "required": [
              "type"
            ]
          }
        ]
      },
      "request": {
        "type": "object",
        "required": [
          "actor",
          "body",
          "createdAt"
        ],
        "properties": {
          "actor": {
            "$ref": "#/$defs/humanActor"
          },
          "body": {
            "type": "string",
            "minLength": 1
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false
      },
      "target": {
        "type": "object",
        "required": [
          "node"
        ],
        "properties": {
          "node": {
            "$ref": "#/$defs/id"
          }
        },
        "additionalProperties": false
      },
      "origin": {
        "type": "object",
        "required": [
          "parent"
        ],
        "properties": {
          "parent": {
            "$ref": "#/$defs/id"
          }
        },
        "additionalProperties": false
      },
      "nodePrecondition": {
        "type": "object",
        "required": [
          "nodeRevision"
        ],
        "properties": {
          "nodeRevision": {
            "$ref": "#/$defs/revision"
          },
          "expectedText": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "parentPrecondition": {
        "type": "object",
        "required": [
          "nodeRevision"
        ],
        "properties": {
          "nodeRevision": {
            "$ref": "#/$defs/revision"
          }
        },
        "additionalProperties": false
      },
      "range": {
        "type": "object",
        "required": [
          "start",
          "end",
          "unit"
        ],
        "properties": {
          "start": {
            "type": "integer",
            "minimum": 0
          },
          "end": {
            "type": "integer",
            "minimum": 0
          },
          "unit": {
            "const": "unicode-code-point"
          }
        },
        "additionalProperties": false
      },
      "destination": {
        "type": "object",
        "required": [
          "parent"
        ],
        "properties": {
          "parent": {
            "$ref": "#/$defs/id"
          },
          "before": {
            "$ref": "#/$defs/id"
          },
          "after": {
            "$ref": "#/$defs/id"
          },
          "index": {
            "type": "integer",
            "minimum": 0
          }
        },
        "not": {
          "anyOf": [
            {
              "required": [
                "before",
                "after"
              ]
            },
            {
              "required": [
                "before",
                "index"
              ]
            },
            {
              "required": [
                "after",
                "index"
              ]
            }
          ]
        },
        "additionalProperties": false
      },
      "createDocumentOperation": {
        "type": "object",
        "required": [
          "id",
          "op",
          "value"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "op": {
            "const": "create_document"
          },
          "value": {
            "$ref": "document.schema.json"
          }
        },
        "additionalProperties": false
      },
      "replaceTextOperation": {
        "type": "object",
        "required": [
          "id",
          "op",
          "target",
          "precondition",
          "range",
          "value"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "op": {
            "const": "replace_text"
          },
          "target": {
            "$ref": "#/$defs/target"
          },
          "precondition": {
            "$ref": "#/$defs/nodePrecondition"
          },
          "range": {
            "$ref": "#/$defs/range"
          },
          "value": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "replaceInlineOperation": {
        "type": "object",
        "required": [
          "id",
          "op",
          "target",
          "precondition",
          "value"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "op": {
            "const": "replace_inline"
          },
          "target": {
            "$ref": "#/$defs/target"
          },
          "precondition": {
            "$ref": "#/$defs/nodePrecondition"
          },
          "value": {
            "type": "array",
            "items": {
              "$ref": "document.schema.json#/$defs/inline"
            }
          }
        },
        "additionalProperties": false
      },
      "insertNodeOperation": {
        "type": "object",
        "required": [
          "id",
          "op",
          "destination",
          "destinationPrecondition",
          "value"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "op": {
            "const": "insert_node"
          },
          "destination": {
            "$ref": "#/$defs/destination"
          },
          "destinationPrecondition": {
            "$ref": "#/$defs/parentPrecondition"
          },
          "value": {
            "$ref": "document.schema.json#/$defs/node"
          }
        },
        "additionalProperties": false
      },
      "deleteNodeOperation": {
        "type": "object",
        "required": [
          "id",
          "op",
          "target",
          "precondition",
          "origin",
          "originPrecondition"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "op": {
            "const": "delete_node"
          },
          "target": {
            "$ref": "#/$defs/target"
          },
          "precondition": {
            "$ref": "#/$defs/nodePrecondition"
          },
          "origin": {
            "$ref": "#/$defs/origin"
          },
          "originPrecondition": {
            "$ref": "#/$defs/parentPrecondition"
          }
        },
        "additionalProperties": false
      },
      "moveNodeOperation": {
        "type": "object",
        "required": [
          "id",
          "op",
          "target",
          "precondition",
          "origin",
          "originPrecondition",
          "destination",
          "destinationPrecondition"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "op": {
            "const": "move_node"
          },
          "target": {
            "$ref": "#/$defs/target"
          },
          "precondition": {
            "$ref": "#/$defs/nodePrecondition"
          },
          "origin": {
            "$ref": "#/$defs/origin"
          },
          "originPrecondition": {
            "$ref": "#/$defs/parentPrecondition"
          },
          "destination": {
            "$ref": "#/$defs/destination"
          },
          "destinationPrecondition": {
            "$ref": "#/$defs/parentPrecondition"
          }
        },
        "additionalProperties": false
      },
      "setAttrsOperation": {
        "type": "object",
        "required": [
          "id",
          "op",
          "target",
          "precondition",
          "value"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "op": {
            "const": "set_attrs"
          },
          "target": {
            "$ref": "#/$defs/target"
          },
          "precondition": {
            "$ref": "#/$defs/nodePrecondition"
          },
          "value": {
            "type": [
              "object",
              "null"
            ]
          }
        },
        "additionalProperties": false
      },
      "updateOperation": {
        "oneOf": [
          {
            "$ref": "#/$defs/replaceTextOperation"
          },
          {
            "$ref": "#/$defs/replaceInlineOperation"
          },
          {
            "$ref": "#/$defs/insertNodeOperation"
          },
          {
            "$ref": "#/$defs/deleteNodeOperation"
          },
          {
            "$ref": "#/$defs/moveNodeOperation"
          },
          {
            "$ref": "#/$defs/setAttrsOperation"
          }
        ]
      },
      "decision": {
        "type": "object",
        "required": [
          "status",
          "actor",
          "at"
        ],
        "properties": {
          "status": {
            "enum": [
              "accepted",
              "rejected",
              "superseded"
            ]
          },
          "actor": {
            "$ref": "#/$defs/humanActor"
          },
          "at": {
            "type": "string",
            "format": "date-time"
          },
          "reason": {
            "type": "string"
          },
          "resultRevision": {
            "$ref": "#/$defs/revision"
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false
      }
    }
  },
  "document": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://dstar.dev/spec/0.1/schemas/document.schema.json",
    "title": "DSTAR 0.1 Base Document",
    "allOf": [
      {
        "$ref": "#/$defs/node"
      },
      {
        "properties": {
          "type": {
            "const": "document"
          }
        }
      }
    ],
    "$defs": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255,
        "pattern": "^[A-Za-z][A-Za-z0-9._:-]*$"
      },
      "packageRelativePath": {
        "type": "string",
        "pattern": "^(?:(?!\\.\\.?(?:/|$))[^/:\\\\\\u0000]+/)*(?!\\.\\.?$)[^/:\\\\\\u0000]+$"
      },
      "mark": {
        "type": "object",
        "required": [
          "type"
        ],
        "properties": {
          "type": {
            "type": "string",
            "minLength": 1
          },
          "attrs": {
            "type": "object"
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false,
        "allOf": [
          {
            "if": {
              "properties": {
                "type": {
                  "const": "link"
                }
              },
              "required": [
                "type"
              ]
            },
            "then": {
              "required": [
                "attrs"
              ],
              "properties": {
                "attrs": {
                  "type": "object",
                  "required": [
                    "href"
                  ],
                  "properties": {
                    "href": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "additionalProperties": true
                }
              }
            }
          }
        ]
      },
      "inline": {
        "type": "object",
        "required": [
          "type"
        ],
        "properties": {
          "type": {
            "type": "string",
            "minLength": 1
          },
          "text": {
            "type": "string"
          },
          "attrs": {
            "type": "object"
          },
          "marks": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/mark"
            }
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false,
        "allOf": [
          {
            "if": {
              "properties": {
                "type": {
                  "const": "text"
                }
              },
              "required": [
                "type"
              ]
            },
            "then": {
              "required": [
                "text"
              ]
            }
          }
        ]
      },
      "node": {
        "type": "object",
        "required": [
          "id",
          "type"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "type": {
            "type": "string",
            "minLength": 1
          },
          "attrs": {
            "type": "object"
          },
          "content": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/inline"
            }
          },
          "children": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/node"
            }
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false,
        "allOf": [
          {
            "if": {
              "properties": {
                "type": {
                  "const": "document"
                }
              },
              "required": [
                "type"
              ]
            },
            "then": {
              "required": [
                "children"
              ],
              "not": {
                "required": [
                  "content"
                ]
              }
            }
          },
          {
            "if": {
              "properties": {
                "type": {
                  "const": "heading"
                }
              },
              "required": [
                "type"
              ]
            },
            "then": {
              "required": [
                "attrs",
                "content"
              ],
              "properties": {
                "attrs": {
                  "type": "object",
                  "required": [
                    "level"
                  ],
                  "properties": {
                    "level": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 6
                    }
                  },
                  "additionalProperties": false
                }
              },
              "not": {
                "required": [
                  "children"
                ]
              }
            }
          },
          {
            "if": {
              "properties": {
                "type": {
                  "const": "paragraph"
                }
              },
              "required": [
                "type"
              ]
            },
            "then": {
              "required": [
                "content"
              ],
              "not": {
                "required": [
                  "children"
                ]
              }
            }
          },
          {
            "if": {
              "properties": {
                "type": {
                  "const": "image"
                }
              },
              "required": [
                "type"
              ]
            },
            "then": {
              "required": [
                "attrs"
              ],
              "properties": {
                "attrs": {
                  "type": "object",
                  "required": [
                    "src",
                    "alt"
                  ],
                  "properties": {
                    "src": {
                      "$ref": "#/$defs/packageRelativePath"
                    },
                    "alt": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "additionalProperties": false
                }
              },
              "not": {
                "anyOf": [
                  {
                    "required": [
                      "content"
                    ]
                  },
                  {
                    "required": [
                      "children"
                    ]
                  }
                ]
              }
            }
          }
        ]
      }
    }
  },
  "manifest": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://dstar.dev/spec/0.1/schemas/manifest.schema.json",
    "title": "DSTAR 0.1 Manifest",
    "type": "object",
    "required": [
      "dstar",
      "id",
      "revision",
      "headChange",
      "title",
      "profiles",
      "document",
      "changes"
    ],
    "properties": {
      "dstar": {
        "const": "0.1"
      },
      "id": {
        "$ref": "#/$defs/id"
      },
      "revision": {
        "$ref": "#/$defs/revision"
      },
      "headChange": {
        "$ref": "#/$defs/id"
      },
      "title": {
        "type": "string"
      },
      "profiles": {
        "type": "array",
        "minItems": 1,
        "uniqueItems": true,
        "items": {
          "type": "string",
          "minLength": 1
        }
      },
      "document": {
        "const": "document.json"
      },
      "annotations": {
        "const": "annotations"
      },
      "sources": {
        "const": "sources.json"
      },
      "changes": {
        "const": "changes"
      },
      "assets": {
        "const": "assets"
      },
      "projections": {
        "const": "projections/index.json"
      }
    },
    "patternProperties": {
      "^x-": true
    },
    "additionalProperties": false,
    "$defs": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255,
        "pattern": "^[A-Za-z][A-Za-z0-9._:-]*$"
      },
      "revision": {
        "type": "string",
        "pattern": "^sha256:[0-9a-f]{64}$"
      }
    }
  },
  "projection": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://dstar.dev/spec/0.1/schemas/projection.schema.json",
    "title": "DSTAR 0.1 Projection Index",
    "type": "object",
    "required": [
      "projections"
    ],
    "properties": {
      "projections": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/projection"
        }
      }
    },
    "patternProperties": {
      "^x-": true
    },
    "additionalProperties": false,
    "$defs": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 255,
        "pattern": "^[A-Za-z][A-Za-z0-9._:-]*$"
      },
      "revision": {
        "type": "string",
        "pattern": "^sha256:[0-9a-f]{64}$"
      },
      "packageRelativePath": {
        "type": "string",
        "pattern": "^(?:(?!\\.\\.?(?:/|$))[^/:\\\\\\u0000]+/)*(?!\\.\\.?$)[^/:\\\\\\u0000]+$"
      },
      "actor": {
        "type": "object",
        "required": [
          "type",
          "id"
        ],
        "properties": {
          "type": {
            "enum": [
              "human",
              "service"
            ]
          },
          "id": {
            "$ref": "#/$defs/id"
          },
          "name": {
            "type": "string"
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false
      },
      "generator": {
        "type": "object",
        "required": [
          "actor"
        ],
        "properties": {
          "actor": {
            "$ref": "#/$defs/actor"
          },
          "version": {
            "type": "string"
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false
      },
      "textPositionSelector": {
        "type": "object",
        "required": [
          "type",
          "start",
          "end",
          "unit"
        ],
        "properties": {
          "type": {
            "const": "TextPositionSelector"
          },
          "start": {
            "type": "integer",
            "minimum": 0
          },
          "end": {
            "type": "integer",
            "minimum": 0
          },
          "unit": {
            "const": "unicode-code-point"
          }
        },
        "additionalProperties": false
      },
      "textQuoteSelector": {
        "type": "object",
        "required": [
          "type",
          "exact"
        ],
        "properties": {
          "type": {
            "const": "TextQuoteSelector"
          },
          "exact": {
            "type": "string",
            "minLength": 1
          },
          "prefix": {
            "type": "string"
          },
          "suffix": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "fragmentSelector": {
        "type": "object",
        "required": [
          "type",
          "value"
        ],
        "properties": {
          "type": {
            "const": "FragmentSelector"
          },
          "value": {
            "type": "string",
            "minLength": 1
          }
        },
        "additionalProperties": false
      },
      "projectionSelector": {
        "oneOf": [
          {
            "$ref": "#/$defs/textPositionSelector"
          },
          {
            "$ref": "#/$defs/textQuoteSelector"
          },
          {
            "$ref": "#/$defs/fragmentSelector"
          }
        ]
      },
      "nodeSelector": {
        "type": "object",
        "required": [
          "type",
          "node"
        ],
        "properties": {
          "type": {
            "const": "NodeSelector"
          },
          "node": {
            "$ref": "#/$defs/id"
          },
          "refinedBy": {
            "type": "array",
            "minItems": 1,
            "maxItems": 2,
            "uniqueItems": true,
            "items": {
              "oneOf": [
                {
                  "$ref": "#/$defs/textPositionSelector"
                },
                {
                  "$ref": "#/$defs/textQuoteSelector"
                }
              ]
            }
          }
        },
        "additionalProperties": false
      },
      "nodePoint": {
        "type": "object",
        "required": [
          "node",
          "offset"
        ],
        "properties": {
          "node": {
            "$ref": "#/$defs/id"
          },
          "offset": {
            "type": "integer",
            "minimum": 0
          }
        },
        "additionalProperties": false
      },
      "nodeRangeSelector": {
        "type": "object",
        "required": [
          "type",
          "start",
          "end",
          "unit",
          "exact"
        ],
        "properties": {
          "type": {
            "const": "NodeRangeSelector"
          },
          "start": {
            "$ref": "#/$defs/nodePoint"
          },
          "end": {
            "$ref": "#/$defs/nodePoint"
          },
          "unit": {
            "const": "unicode-code-point"
          },
          "exact": {
            "type": "string",
            "minLength": 1
          },
          "viewExact": {
            "type": "string",
            "minLength": 1
          },
          "prefix": {
            "type": "string"
          },
          "suffix": {
            "type": "string"
          }
        },
        "additionalProperties": false
      },
      "canonicalTarget": {
        "type": "object",
        "required": [
          "relation",
          "selector"
        ],
        "properties": {
          "relation": {
            "enum": [
              "exact",
              "transformed",
              "summarizes"
            ]
          },
          "selector": {
            "oneOf": [
              {
                "$ref": "#/$defs/nodeSelector"
              },
              {
                "$ref": "#/$defs/nodeRangeSelector"
              }
            ]
          }
        },
        "additionalProperties": false
      },
      "segment": {
        "type": "object",
        "required": [
          "id",
          "selectors",
          "derivedFrom"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "selectors": {
            "type": "array",
            "minItems": 1,
            "items": {
              "$ref": "#/$defs/projectionSelector"
            }
          },
          "derivedFrom": {
            "type": "array",
            "minItems": 1,
            "items": {
              "$ref": "#/$defs/canonicalTarget"
            }
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false
      },
      "projection": {
        "type": "object",
        "required": [
          "id",
          "role",
          "mediaType",
          "path",
          "reviewable",
          "generatedFromRevision",
          "revision"
        ],
        "properties": {
          "id": {
            "$ref": "#/$defs/id"
          },
          "role": {
            "type": "string",
            "minLength": 1
          },
          "mediaType": {
            "type": "string",
            "pattern": "^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$"
          },
          "path": {
            "$ref": "#/$defs/packageRelativePath"
          },
          "reviewable": {
            "type": "boolean"
          },
          "generatedFromRevision": {
            "$ref": "#/$defs/revision"
          },
          "revision": {
            "$ref": "#/$defs/revision"
          },
          "generator": {
            "$ref": "#/$defs/generator"
          },
          "segments": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/segment"
            }
          }
        },
        "patternProperties": {
          "^x-": true
        },
        "additionalProperties": false,
        "allOf": [
          {
            "if": {
              "properties": {
                "reviewable": {
                  "const": true
                }
              },
              "required": [
                "reviewable"
              ]
            },
            "then": {
              "required": [
                "segments"
              ],
              "properties": {
                "segments": {
                  "minItems": 1
                }
              }
            }
          }
        ]
      }
    }
  },
  "sources": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://dstar.dev/spec/0.1/schemas/sources.schema.json",
    "title": "DSTAR 0.1 Sources",
    "type": "object",
    "required": [
      "sources"
    ],
    "properties": {
      "sources": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "id",
            "type",
            "title"
          ],
          "properties": {
            "id": {
              "type": "string",
              "minLength": 1,
              "maxLength": 255,
              "pattern": "^[A-Za-z][A-Za-z0-9._:-]*$"
            },
            "type": {
              "enum": [
                "url",
                "file",
                "citation"
              ]
            },
            "title": {
              "type": "string"
            },
            "url": {
              "type": "string",
              "format": "uri"
            },
            "path": {
              "$ref": "#/$defs/packageRelativePath"
            },
            "accessedAt": {
              "type": "string",
              "format": "date-time"
            }
          },
          "patternProperties": {
            "^x-": true
          },
          "additionalProperties": false
        }
      }
    },
    "additionalProperties": false,
    "$defs": {
      "packageRelativePath": {
        "type": "string",
        "pattern": "^(?:(?!\\.\\.?(?:/|$))[^/:\\\\\\u0000]+/)*(?!\\.\\.?$)[^/:\\\\\\u0000]+$"
      }
    }
  }
} as const;

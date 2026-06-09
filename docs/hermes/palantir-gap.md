# Palantir Competitive Brief: Gotham & Foundry vs. BDOC

_hermes/overnight-2026-06-09 — public material only, no proprietary/internal detail._

## 1. Gotham strengths (defense/intel)

- **Data fusion/integration**: Gotham ingests heterogeneous classified and open sources — SIGINT, HUMINT reporting, GEOINT, sensor feeds, document corpora — and resolves them into a single linked object model. Entity resolution (deduplicating the same person/vehicle/event across sources) is a core, mature capability.
- **Ontology layer**: A shared semantic model of objects (people, places, events, equipment) and their relationships that sits above raw data, so analysts reason about real-world entities rather than tables.
- **Analyst UX/workflow**: Graph/link analysis, geotemporal mapping, timeline reconstruction, and search built for non-engineers. Tradecraft like nominations, target packages, and collaborative casework are first-class.
- **Speed-to-insight**: Pre-built investigative workflows and connected data collapse the time from "question" to "answer." Cross-source pivots that would take days manually happen interactively.
- **Deployment model**: Runs in classified, air-gapped, and tactical/edge environments (including disconnected forward deployments). Accredited for high-side networks; strong access controls and data lineage for audit.

## 2. Foundry strengths (commercial/enterprise)

- **Data fusion/integration**: Connects ERP, supply chain, sensor, and operational systems into one integrated layer with pipeline tooling, data lineage, and version control. Strong at messy enterprise data plumbing.
- **Ontology layer**: The same object/relationship model, applied to business entities (factories, orders, equipment, customers). Becomes the shared "digital twin" of the operation that apps and models read/write against.
- **Analyst/operator UX/workflow**: Low-code app builder (Workshop), Quiver/Contour for analysis, and "Actions" that let users write decisions back to source systems — closing the loop from insight to operational change.
- **Speed-to-insight**: AIP (Artificial Intelligence Platform) wires LLMs to the ontology so models act on governed, real enterprise objects rather than free text, with human-in-the-loop guardrails.
- **Deployment model**: Cloud, hybrid, and on-prem. Sold as an operating system for the enterprise; heavy forward-deployed-engineer professional-services model to stand up use cases.

## 3. The ontology layer (plain English)

Palantir's ontology is a **shared map of the real world expressed as software objects**. Instead of leaving data as disconnected tables and files, Palantir defines the things that matter (a ship, a sanction, a unit, a shipment) as **objects with properties, links to other objects, and actions you can take on them**. Every dataset, dashboard, model, and user reasons against this same model.

It is the moat for three reasons: (1) **it is built from the customer's own integrated data**, so it deepens and gets stickier with every source connected; (2) **it bridges data and decisions** — apps, AI, and write-back actions all hang off it, so ripping it out means rebuilding the whole operational layer; (3) **it encodes governance and lineage**, which regulated/defense buyers require. The ontology isn't the algorithm; it's the **accumulated, governed integration of an organization's data into a usable model** — expensive to recreate and the thing customers actually pay for.

## 4. Feature-gap list mapped to BDOC

- **Multi-source live fusion** — *Approachable.* BDOC already fuses 50+ OSINT feeds on one globe. Build task: a normalized internal schema (entity types: vessel, aircraft, event, asset) so layers cross-reference instead of just stacking visually.
- **Entity resolution** — *Partially approachable.* Lightweight matching (same MMSI/ICAO, fuzzy name/callsign, geospatial proximity) is buildable. Full multi-source identity resolution at Palantir's depth is out of reach without large labeled data and engineering — scope it narrowly per layer.
- **A real ontology / object model** — *Approachable at small scale.* Build task: define a typed object graph in Postgres (Supabase) linking aircraft↔operator↔sanctions↔event, expose pivots in the UI. This is the single highest-leverage move; it converts BDOC from a map into an analysis tool.
- **Analyst workflow (cases, link analysis, timelines)** — *Approachable.* Build task: a "Case" object that pins entities/events, a relationship graph view, and a geotemporal timeline scrubber. Differentiator vs. pure map apps.
- **Write-back / operational actions** — *Mostly out of reach / lower priority.* BDOC's value is observation, not driving enterprise systems. Approximate with exports, alerts, and shareable reports instead.
- **AI on governed objects (AIP-style)** — *Approachable in spirit.* BDOC's copilot can be wired to the object graph so it answers about resolved entities, not raw tiles. Build task: tool-calling over the Postgres ontology with citations back to source layers.
- **Air-gapped/classified deployment & accreditation** — *Out of reach.* Requires accreditation, on-prem/high-side engineering, and a services org. Don't compete here; serve the unclassified/OSINT tier Palantir underserves.
- **Forward-deployed engineering / bespoke integration** — *Out of reach.* That's a services business. BDOC's advantage is self-serve, no-implementation onboarding.

## 5. Top-3 "build next" recommendations

1. **A lightweight ontology + entity pivots** — turn stacked layers into linked objects (aircraft→operator→sanctions→event) so a single click reveals relationships; this is the cheapest path to "analysis tool, not just a map."
2. **Saved Cases with geotemporal timeline + shareable briefs** — let a solo analyst pin entities, reconstruct a timeline, and export a clean intel brief, capturing the daily tradecraft workflow Palantir gates behind enterprise contracts.
3. **Ontology-grounded AI copilot with source citations** — wire the copilot to the object graph so answers cite which OSINT layer/feed they came from, giving small teams trustworthy, auditable insight at a self-serve price Palantir won't match.

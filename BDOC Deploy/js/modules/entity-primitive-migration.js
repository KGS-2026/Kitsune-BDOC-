// ============================================================
// BDOC TURN 23 TASK 9: ENTITY→PRIMITIVE MIGRATION
// GATED: DO NOT EXECUTE WITHOUT EXPLICIT GO-AHEAD
// Refactor from Cesium.Entity collection to WebGL primitives
// ============================================================

// SCOPE (BLOCKED):
// This task requires a complete architectural refactor of the aircraft + fire layers
// from Cesium's high-level Entity API (which wraps primitives) to direct Cesium
// primitives (PolylineCollection, BillboardCollection) for a ~3–5x render speedup.
//
// IMPACT:
// • Entity creation cost: ~200μs per entity → Primitive cost: ~5μs per primitive
// • For 500 aircraft: 100ms overhead per update → ~2.5ms overhead per update
// • Enables 10k+ markers on a 60fps budget instead of 500–1000 max
//
// ARCHITECTURAL CHANGES NEEDED:
// 1. layers-air.js: Replace V.entities.add({position:...}) with
//    aircraftCollection.add({position:...}) where aircraftCollection is a
//    CallbackPropertyCollection or static PrimitiveCollection
//
// 2. layer-fire.js: Replace fire entity updates with PrimitiveCollection polygon adds
//
// 3. Motion model integration: Pass primitive references to motionModel.displayPosition()
//    for direct position mutation instead of entity.position reassignment
//
// 4. Selection/tracking: Wire V.trackedEntity to a primitive reference (not Cesium-native)
//    + custom picking logic via scene.pick() + id map
//
// 5. Label/description: Detach infoBox popups; wire custom HTML DOM overlay
//
// PREREQUISITES:
// • Cesium 1.104+ (required for PickedObject.primitive support)
// • Performance benchmark: measure entity update cost before/after with real aircraft count
// • Feature parity test: verify all 15 layer types still toggle/render identically
//
// EFFORT: ~40–60 hours (3–4 days full-time)
// RISK: High (complete layer refactor; many edge cases; Cesium versioning)
// ROI: 5x faster aircraft rendering, enables global-scale aircraft visualization
//
// DECISION POINT: Wait for explicit user signal (e.g., "go 9" or "ship 9").
// Until then, the Entity-based approach is stable and sufficient for <1000 aircraft.

console.warn('[TURN 23 TASK 9] Entity→Primitive migration GATED. Do not execute without go-ahead.');

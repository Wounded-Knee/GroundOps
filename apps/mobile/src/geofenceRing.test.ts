import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeoCoordinate } from "@groundops/contracts";
import {
  addVertex,
  applyMapTap,
  cameraForRing,
  clearRing,
  deleteSelectedVertex,
  displayPolygonCoordinates,
  emptyRingState,
  isValidRing,
  moveSelectedVertex,
  normalizeRing,
  ringFromProps,
  selectVertex,
  setVertexAt,
  undoLastAdd,
} from "./geofenceRing.js";

const a: GeoCoordinate = { latitude: 40.7, longitude: -74.0 };
const b: GeoCoordinate = { latitude: 40.71, longitude: -74.0 };
const c: GeoCoordinate = { latitude: 40.71, longitude: -73.99 };
const d: GeoCoordinate = { latitude: 40.7, longitude: -73.99 };

describe("geofenceRing", () => {
  it("normalizes a closed ring by dropping the duplicated last point", () => {
    assert.deepEqual(normalizeRing([a, b, c, a]), [a, b, c]);
    assert.deepEqual(normalizeRing([a, b, c]), [a, b, c]);
    assert.deepEqual(normalizeRing([]), []);
  });

  it("seeds state from props without a selection", () => {
    assert.deepEqual(ringFromProps([a, b, c, a]), {
      vertices: [a, b, c],
      selectedIndex: null,
    });
  });

  it("adds vertices and clears selection", () => {
    let state = emptyRingState();
    state = addVertex(state, a);
    state = selectVertex(state, 0);
    state = addVertex(state, b);
    assert.deepEqual(state.vertices, [a, b]);
    assert.equal(state.selectedIndex, null);
  });

  it("toggles selection on the same vertex", () => {
    let state = ringFromProps([a, b, c]);
    state = selectVertex(state, 1);
    assert.equal(state.selectedIndex, 1);
    state = selectVertex(state, 1);
    assert.equal(state.selectedIndex, null);
  });

  it("moves the selected vertex then clears selection", () => {
    let state = ringFromProps([a, b, c]);
    state = selectVertex(state, 1);
    state = moveSelectedVertex(state, d);
    assert.deepEqual(state.vertices, [a, d, c]);
    assert.equal(state.selectedIndex, null);
  });

  it("sets a vertex by index and keeps it selected", () => {
    let state = ringFromProps([a, b, c]);
    state = setVertexAt(state, 0, d);
    assert.deepEqual(state.vertices, [d, b, c]);
    assert.equal(state.selectedIndex, 0);
  });

  it("deletes the selected vertex", () => {
    let state = ringFromProps([a, b, c]);
    state = selectVertex(state, 0);
    state = deleteSelectedVertex(state);
    assert.deepEqual(state.vertices, [b, c]);
    assert.equal(state.selectedIndex, null);
  });

  it("undoes the last add", () => {
    let state = ringFromProps([a, b]);
    state = addVertex(state, c);
    state = undoLastAdd(state);
    assert.deepEqual(state.vertices, [a, b]);
  });

  it("clears the ring", () => {
    assert.deepEqual(clearRing(ringFromProps([a, b, c])), emptyRingState());
  });

  it("applies map taps as move when selected, otherwise add", () => {
    let state = ringFromProps([a, b]);
    state = applyMapTap(state, c);
    assert.deepEqual(state.vertices, [a, b, c]);
    state = selectVertex(state, 2);
    state = applyMapTap(state, d);
    assert.deepEqual(state.vertices, [a, b, d]);
  });

  it("validates rings of at least three vertices", () => {
    assert.equal(isValidRing([]), false);
    assert.equal(isValidRing([a, b]), false);
    assert.equal(isValidRing([a, b, c]), true);
  });

  it("closes the ring for polygon display", () => {
    assert.deepEqual(displayPolygonCoordinates([a, b]), []);
    assert.deepEqual(displayPolygonCoordinates([a, b, c]), [a, b, c, a]);
  });

  it("centers the camera on the ring centroid", () => {
    const camera = cameraForRing([a, c], { latitude: 0, longitude: 0, zoom: 14 });
    assert.equal(camera.latitude, (a.latitude + c.latitude) / 2);
    assert.equal(camera.longitude, (a.longitude + c.longitude) / 2);
    assert.equal(camera.zoom, 14);
  });
});

# 🐛 Bugs & Architecture Concerns Report

**ShelfEye Repository Analysis**  
**Date:** November 10, 2025  
**Status:** Comprehensive Audit Complete  
**Risk Level:** HIGH - Critical bugs identified that will break multi-camera support

---

## 📊 Executive Summary

This report identifies **critical bugs and architecture concerns** organized into **5 implementation phases**. All issues prioritized by risk and impact on system stability.

### Key Findings:
- ⚠️ **3 Critical Data Corruption Risks** (Phase 0)
- ⚠️ **2 Medium Risk Issues** (Phase 1)
- ⚠️ **3 High Risk Backend Issues** (Phase 2)
- ⚠️ **3 Medium Risk Frontend Issues** (Phase 3)
- ⚠️ **2 High Risk Testing Issues** (Phase 4)

**Total Issues:** 13  
**Breaking Changes:** 0 (all preserve single-camera stability)

---

## 🔴 PHASE 0: Critical Bugs - Multi-Camera Stability

**Priority:** CRITICAL 🔴  
**Impact:** System will crash or corrupt data without fixes  
**Effort:** 4-6 hours

### Issue 0.1: Missing `paperSize` Database Field

**File:** `shared/schema.ts` (lines 6-18)  
**Severity:** 🔴 CRITICAL  
**Category:** Data Persistence Bug

**Problem:**
Cameras lose their selected template (paperSize) after reboot because the database field doesn't exist.

**Current Code (Broken):**
```typescript
export const cameras = pgTable("cameras", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  deviceIndex: integer("device_index"),
  devicePath: text("device_path"),
  resolution: json("resolution").$type<[number, number]>().notNull().default([3840, 2160]),
  homographyMatrix: json("homography_matrix").$type<number[]>(),
  cameraMatrix: json("camera_matrix").$type<number[]>(),
  distCoeffs: json("dist_coeffs").$type<number[]>(),
  calibrationTimestamp: timestamp("calibration_timestamp"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
  // ❌ MISSING: paperSize field
});
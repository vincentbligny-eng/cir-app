# TED and System Conditional - Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [TED (Transistor Error Detection)](#ted-transistor-error-detection)
   - [Purpose](#purpose)
   - [How TED Works](#how-ted-works)
   - [TED-Top Circuits](#ted-top-circuits)
   - [TED Threshold and Complexity](#ted-threshold-and-complexity)
   - [Error Types Detected by TED](#error-types-detected-by-ted)
   - [TED Limitations](#ted-limitations)
3. [System Conditional](#system-conditional)
   - [Purpose](#system-conditional-purpose)
   - [Two Main Roles](#two-main-roles)
   - [Original Approach (SAT-based)](#original-approach-sat-based)
   - [Dynamic System Conditional](#dynamic-system-conditional)
4. [Dynamic System Conditional - Detailed Design](#dynamic-system-conditional---detailed-design)
   - [General Approach](#general-approach)
   - [Net States](#net-states)
   - [Data Models](#data-models)
   - [Conflict Detection and Resolution](#conflict-detection-and-resolution)
   - [Re-scoping](#re-scoping)
5. [Conditional Leakage with TED](#conditional-leakage-with-ted)
6. [System Conditional - Uncovered Topologies](#system-conditional---uncovered-topologies)
7. [API Reference](#api-reference)
8. [Configuration and Usage](#configuration-and-usage)

---

## Overview

**TED** (Transistor Error Detection) and **System Conditional** are two complementary analysis phases in the Aniah/OneCheck ERC (Electrical Rule Check) tool. Together, they provide comprehensive detection and validation of electrical errors (such as High Impedance states and short circuits) in integrated circuit designs.

- **TED** analyzes small-to-medium circuits (called TED-top circuits) by enumerating all possible input combinations and detecting errors such as conditional HiZ (High Impedance) states, missing isolation, and conditional leakage.
- **System Conditional** extends the analysis beyond TED-top circuits to the full system level, validating and qualifying errors detected by TED, and discovering new potential errors in regions not covered by TED.

---

## TED (Transistor Error Detection)

### Purpose

TED is the core error-detection engine in Aniah. It performs exhaustive enumeration of input configurations on transistor-level circuits to detect:

- **Conditional HiZ errors**: A net is left in a floating (High Impedance) state under certain input conditions.
- **Missing isolation errors**: A net is in HiZ and has an active electrical path connecting it to a HiZ supply.
- **Conditional leakage (contention)**: A simultaneous current path between pull-up and pull-down stacks due to unintended gating during certain states.

### How TED Works

1. **Circuit Identification**: TED identifies subcircuits (called **TED-top circuits**) that fall within a configurable complexity threshold.
2. **Input Enumeration**: For each TED-top circuit, TED enumerates all possible input configurations (combinations of supply values: High/Low).
3. **State Propagation**: For each input configuration, TED propagates signal states through the transistor network using a switch-based model:
   - A **p-type transistor** is *passing* when its gate is **Low**.
   - An **n-type transistor** is *passing* when its gate is **High**.
4. **Truth Table Construction**: TED builds a truth table mapping input configurations to the state of every internal net (High, Low, HiZ, or Short Circuit).
5. **Error Detection**: From the truth table, TED identifies:
   - Nets in a **HiZ state** connected to a transistor gate (conditional HiZ error).
   - Nets in a **Short Circuit state** with no HiZ net involved (conditional leakage).
6. **Error Inheritance**: Errors detected in lower-level circuits are inherited and propagated to higher-level circuits through hierarchical analysis using nPole rules.

### TED-Top Circuits

A **TED-top circuit** is a subcircuit selected for TED analysis based on its complexity. TED-top selection is controlled by:

- **Threshold complexity parameter**: Circuits exceeding this threshold are not analyzed by TED directly.
- **TED In/Out selection**: Controls which pins are treated as inputs vs. outputs.

TED recursively analyzes circuits from bottom cells up to TED-top level. Errors found in sub-circuits are inherited upward through hierarchical error management.

### TED Threshold and Complexity

TED uses an internal threshold to manage computational complexity:

- **Fast analysis**: Lower complexity threshold (~10,000), faster but covers fewer cells.
- **Extended analysis**: Higher complexity threshold (~1,000,000), more cells analyzed, more errors potentially found.
- **SoC analysis**: Full system-on-chip level analysis.

The complexity depends primarily on the **number of input variables**. Internal variables increase complexity exponentially. A **compacting process** is used to reduce the influence of internal variables.

### Error Types Detected by TED

| Error Type | Description | Detection Method |
|---|---|---|
| **Conditional HiZ** | A net is floating under certain input conditions | HiZ state in truth table connected to a transistor gate |
| **Missing Isolation** | HiZ net with active path to HiZ supply | HiZ + electrical path analysis |
| **Conditional Leakage** | Short circuit between supply and ground | SC state in truth table with no HiZ net for the combination |
| **Bus Contention** | Two outputs driving the same signal simultaneously | Finding leakage between supply and ground |
| **Drive Contention (Rail)** | Multiple power switches with overlapping control states | Two+ components driving same net from different supplies |

### TED Limitations

- **Scalability**: Cannot run on large-scale circuits due to exponential time/space complexity (2^n where n = number of input variables).
- **Coverage gap**: Transistors not covered by any TED-top circuit are not analyzed.
- **False alarms**: At system level, some detected errors may be false positives because input conditions are infeasible in the broader circuit context.

These limitations motivate the **System Conditional** phase.

---

## System Conditional

### System Conditional Purpose

System Conditional extends error analysis beyond TED-top circuits to the full system level. It addresses TED's limitations by:

1. **Validating detected errors**: Confirming whether errors found by TED are real at the system level.
2. **Full coverage**: Detecting errors in circuit regions not covered by TED-top circuits.
3. **Reducing false positives**: Filtering out errors whose input conditions are unreachable at higher levels.

### Two Main Roles

In the System Conditional phase, there are two main objectives:

#### 1. Validity of Detected Errors

Check errors already detected by TED in TED-top circuits:

- **Fully qualified errors**: Both poles (HiZ-pole and SC-pole) are validated.
- **Non-qualified errors**: At least one pole is not yet qualified.

For each error, the process:
1. Identifies **affective input variables** causing the error.
2. Builds a **causality condition list** for the error.
3. For each unique instance through a hierarchical path from top to TED-top:
   - Builds a **partially flattened circuit** within boundary parameters (depth, width, layer).
   - Validates the error using the flattened circuit.
   - Expresses valid errors with causality conditions and a **confidence measurement**.

#### 2. Full Coverage

Detect new potential errors in regions not covered by TED:

- Any **1st, 2nd, or 3rd type free variable** in a TED-top circuit that could indicate a conditional HiZ or missing isolation error.
- Any **transistor not covered by a TED-top circuit** that may signal a potential error.

For each potential error:
- **HiZ Error**: The variable's status is HiZ.
- **Missing Isolation Error**: The variable is HiZ AND has an active electrical path to a HiZ supply.

### Boundary Parameters

The analysis scope is controlled by three parameters:

| Parameter | Description |
|---|---|
| **Depth** | Number of consecutive electrical paths influencing the circuit's variables |
| **Width** | Number of devices (transistors) along the electrical path containing the net |
| **Layer** | Hierarchical distance between two circuits in a hierarchical design |

### Original Approach (SAT-based)

The first release used a SAT-based approach:

1. Build partially flattened circuits for each error.
2. Use **binary search strategy** (Check_SAT) to validate causality conditions.
3. Produce a validation object with binary values (0/1) indicating which conditions remain valid.

**Confidence measurement** was based on:
- Total number of valid causality conditions.
- Total number of valid hierarchical paths.
- Ratio of invalid instances vs. total instances.
- Ratio of valid conditions vs. total conditions.

> **Note**: This approach was superseded by the **Dynamic System Conditional** method due to scalability limitations of partial flattening and SAT solving.

### Dynamic System Conditional

The Dynamic System Conditional replaces the SAT-based approach with a **dynamic hierarchical backtracking** method. It uses backward propagation and leverages pre-existing data models (BAGs) to validate errors incrementally without requiring full circuit flattening.

---

## Dynamic System Conditional - Detailed Design

### General Approach

The Dynamic System Conditional uses an incremental, repetitive, and recursive approach:

**To verify an input condition:**

1. **Initialize** an empty Decision Graph.
2. **For each** `(net, value)` pair in the input condition:
   - Add the pair to the Validation List.
   - Create a corresponding node in the Decision Graph.
3. **While** the Validation List is not empty:
   - Pop a `(net, value)` pair from the list.
   - Evaluate the effect of assigning the value to the net.
   - **If no conflict**: Update the Decision Graph and Validation List.
   - **If conflict is resolvable**: Resolve it, update both structures.
   - **If conflict is unresolvable**: Return **input condition is NOT valid**.
4. If the Validation List becomes empty without unresolved conflicts: Return **input condition is valid**.

### Net States

Each net can be in one of four possible states:

| State | Pull-Up (PU) | Pull-Down (PD) | Description |
|---|---|---|---|
| **High (H)** | PU | not PD | Net is driven high |
| **Low (L)** | not PU | PD | Net is driven low |
| **HiZ (Z)** | not PU | not PD | Net is floating (High Impedance) |
| **SC (X)** | PU | PD | Short circuit between supply and ground |

### Data Models

#### Validation List

A **priority queue** ordered by two criteria:

1. **Depth in the Decision Graph**: Nets closer to initial nodes have higher priority (analysis spreads outward).
2. **Width of analysis**: Among nets at the same depth, those analyzed fewer times are prioritized (ensures broad exploration).

#### Decision Graph (DG)

A dynamic, incrementally built graph where:

- Each **node** represents a unique net in the circuit.
- Most nodes are assigned **High (H)** or **Low (L)**.
- Root nodes (input conditions) can also be **HiZ (Z)** or **SC (X)**.
- The graph expands layer by layer from root nodes.
- Each node has a **legend tag** indicating the assuredness of its assigned value.

**Legend Tags:**

| Tag | Description |
|---|---|
| **Initial** | Fixed value assigned to root nodes; represents starting points of analysis |
| **Tentative** | Temporary value that may be revised as analysis progresses |
| **Enumerate** | Fixed preliminary assignment; can be valid or become invalid through conflicts |
| **Fixed** | Definitive value determined by designers (e.g., supply/ground); cannot be altered |

#### Conflict Graph (CG)

A graph-based data model for managing and resolving conflicts:

- Conflicts are represented as **multiple disjoint paths** of nodes.
- Nodes are ordered based on a **global net ordering**.

**Two types of conflict nodes:**

| Type | Description |
|---|---|
| **Head Conflict Node** | Initial point where a conflict is detected during forward propagation |
| **Consequence Conflict Node** | Created during rollback when a tentative node becomes an enumerated node |

The Conflict Graph supports:
- **Adding** conflict nodes during forward propagation and rollback.
- **Merging** conflict paths when dependencies are found between them.
- **Modifying** node types based on analysis progression.

### Conflict Detection and Resolution

#### Conflict Types

| Conflict Type | Description |
|---|---|
| **Causality Conflict** | Two different values assigned to the same node in the Decision Graph |
| **Foreign Conflict** | Two nodes with opposite values connected through an active electrical path |
| **Impossible Configuration** | Assigned value makes the configuration unsatisfiable |
| **Foreign-Causality Conflict** | Enumeration node introduces a supply/ground conflicting with target value |

#### Detection Process

When assigning value `val` to node `cntl`:

1. **Causality Conflict**: `cntl` already has a different value -> Create head conflict node for `cntl`.
2. **Foreign Conflict**: Assignment connects nodes with opposite values -> Create head conflict nodes for `cntl`, `node1`, `node2`.
3. **Impossible Configuration**: Assignment makes configuration unsatisfiable -> Create head conflict node.
4. **Foreign-Causality Conflict**: Assignment introduces conflicting supply/ground -> Create head conflict nodes for `cntl`, `node1`, `node2`.

#### Resolution Process

1. Create conflict nodes in the Conflict Graph.
2. For each conflict node, identify its corresponding Decision Graph node.
3. **Rollback and re-evaluate** parent nodes recursively.

**Resolution outcomes:**

| Outcome | Description |
|---|---|
| **Steady State (Success)** | Re-evaluation list empty; prune DG, resume forward propagation |
| **Blocked Node (Temporary Failure)** | Reached an unchangeable node; discard current enumeration, try alternative |
| **Exhausted Enumerations (Permanent Failure)** | No alternatives remain; verification is **UNSAT** |

### Re-scoping

When the analysis reaches the boundary of the current subcircuit:

1. Redefine parameters based on the parent circuit.
2. Previously made assumptions may become unsatisfiable in the new scope.
3. Fresh analysis with revised assumptions is required.

This enables the analysis to traverse the circuit hierarchy dynamically.

---

## Conditional Leakage with TED

Conditional leakage detection extends TED's capabilities to identify **contention** and **leakage** errors:

### Types of Leakage

#### Supply-Ground Leakage
A current path exists between pull-up and pull-down stacks due to simultaneous gating. Detected when a net is in **Short Circuit** state in TED's truth table with no HiZ net causing the short.

#### Bus Contention
Two or more outputs drive the same signal simultaneously. Detected by finding leakage between supply and ground when multiple enable signals are active.

#### Drive Contention (Rail Contention)
A rail net is pulled up by multiple power switches to different rails with overlapping control states.

### Detection Method

The selected detection method is SC-driven:

1. **SC state-net detection**: Any net in SC state triggers error detection, collecting all related pins and powers.
2. **Power-pair detection**: Any instance providing a direct supply-to-ground connection, if not already covered by another leakage error.

### Integration with System Conditional

Once enumerated states are imported from TED, System Conditional performs deep validation across the hierarchy:
- Validates leakage conditions.
- Reduces false positives by filtering unreachable states.
- Highlights impacted nets in the synoptic schematic.

---

## System Conditional - Uncovered Topologies

System Conditional must also handle topologies where its standard two-value (High/Low) analysis is insufficient. These are categorized as:

### Category 1: Topologies with Dependency Loops

Nets involved in dependency loops may settle into intermediate values (HiZ or SC). Two handling strategies:

1. **Allow all states** (H, L, Z, X) for loop nets -- increases search space to 4^n.
2. **Accept oscillating behavior** -- treat causality conflicts within loops as non-conflicts, keeping search space at 2^n.

### Category 2: Non-CMOS Topologies

Nets that may simultaneously have both pull-up and pull-down paths active (or neither). Heuristic classification:

- **Topological Signatures**: Only pull-up or pull-down bags -> potential HiZ.
- **Single CMOS topology**: No SC/HiZ risk.
- **Multiple CMOS topologies**: Potential SC risk.
- **Multiple drivers without CMOS match**: Potential SC or HiZ.

### Category 3: Analog Topologies

Structures like current mirrors with continuous analog behavior. Detected via:
- Multiple gates sharing the same net.
- Drain-to-gate connections (diode-connected transistors).
- Lack of complementary pull-up/pull-down bags.

### Category 4: Inaccurate Modeling

Circuits with elements not precisely represented in SysCon's digital model (e.g., diode clamps, ESD structures):
- Detect diodes connected between pin IO and power.
- Confirm no gate-controlled transistor drives the pin.
- Assign HiZ/SC value to improve accuracy.

### NBS (Non-Binary State) Support

The analysis is enhanced in two phases:

- **Phase 1**: NBS with no X-propagation -- NBS nets can take H, L, Z values during conflict resolution.
- **Phase 2**: NBS with X-propagation through inverters -- SC state can propagate through recognized inverter topologies.

---

## API Reference

### Core API - System Conditional Analysis

```typescript
// Create a new system conditional analysis
createSystemConditionalAnalysis(
  cell: string,
  constraints: SystemConditionalNet[],
  options?: SysConOpt
) => SystemConditionalAnalysis

// Configuration options
interface SysConOpt {
  checkLoopDepth?: number;  // default: 1 (negative to deactivate)
  analogMode?: boolean;     // default: false
  monoValUseZ?: boolean;    // default: false
}

// Net definition
interface SystemConditionalNet {
  name: string;
  path?: string[];
  validate?: boolean;
  value?: SystemConditionalNetValue;
}

// Possible net values
enum SystemConditionalNetValue {
  HIGH = "H",
  HIZ = "Z",
  LOW = "L",
  SHORT_CIRCUIT = "X",
  UNKNOWN = "U"
}
```

### System Conditional Analysis Interface

```typescript
interface SystemConditionalAnalysis {
  destroy: () => boolean;
  getBranches: () => SystemConditionalBranch[];
  getStats: () => SystemConditionalStats;
}

interface SystemConditionalStats {
  memoryFootprint: number;  // bytes
  runtime: number;          // ms
  nbBranches: number;
}
```

### System Conditional Branch Interface

```typescript
interface SystemConditionalBranch {
  completed: () => boolean;
  getCell: () => string;
  getMostDistantNets: () => SystemConditionalNet[];
  getPathToRoot: () => string[];
  partialSnapshot: (nets: SystemConditionalNet[]) => SystemConditionalNet[];
  run: (steps: number, stopOnExpand?: boolean) => Promise<int>;
  satisfied: () => boolean;
  snapshot: () => SystemConditionalInstance;
  expanding: () => boolean;
}
```

### Causality Query API (3.5.1+)

```typescript
interface causalityQuery {
  cell: string;
  causeNets: sysConNet[];
  nets: sysConNet[];
}

interface causality {
  causeNet: sysConNet;
  net: sysConNet;
  causality: string;  // Causality path string
}

// Get causality paths between cause nets and consequence nets
async function getCausality(causalityQuery) => Promise<causality[]>;
```

### Usage Example

```javascript
const cell = "cell";
const constraints = [
  { name: "netA", path: ["X1"], validate: true, value: "H" },
  { name: "netB", path: ["X1"], validate: true, value: "L" }
];

const analysis = api.createSystemConditionalAnalysis(cell, constraints);

// Run analysis iteratively
let runned;
for (runned = await runAnalysis(analysis); runned; runned = await runAnalysis(analysis)) {
  const nbBranches = analysis.getBranches().length;
  console.log(`${nbBranches} branches`);
}

// Display results
const branches = analysis.getBranches();
for (const branch of branches) {
  console.log(`Cell: ${branch.getCell()}`);
  console.log(`Satisfied: ${branch.satisfied()}`);
  const nets = branch.getMostDistantNets();
  // ... process results
}

analysis.destroy();
```

---

## Configuration and Usage

### Enabling System Conditional

In the OneCheck global configuration:

1. Select **HiZ error** detection.
2. Choose analysis mode: **Fast analysis**, **Extended analysis**, or **SoC analysis**.
3. Enable **system-conditional-enable-experimental** to activate System Conditional.

### Analysis Modes

| Mode | TED Complexity | Description |
|---|---|---|
| **Fast analysis** | ~10,000 | Quick analysis, fewer cells covered |
| **Extended analysis** | ~1,000,000 | More thorough, covers more cells |
| **SoC analysis** | Full | Complete system-on-chip analysis |

### Error Report Categories (with System Conditional)

When System Conditional is enabled, errors are categorized into 6 levels:

| Category | Description |
|---|---|
| **0. Proven true** | Verified by power and signal definitions |
| **1. Control signal dependent** | Consistent with power setup, depends on signals not in power setup |
| **2. Still consistent** | Error still consistent, but not proven at complete system level |
| **3. Possibly false positive** | Not proven at complete system level |
| **4. False error - unreachable** | Condition unreachable |
| **5. False error - shorted** | Shorted nets with incompatible values |

### SysCon Grouping Fields

System Conditional adds 7 fields to error report grouping:

- **[SYS] Condition compact**: Compacted condition representation
- **[SYS] Condition origin**: Origin of the condition
- **[SYS] Proof**: Proof information for the error
- **[SYS] Runtime details**: Runtime analysis details
- **[SYS] sat runs**: Number of satisfiability runs
- **[SYS] snapshot**: Circuit state snapshot
- **[SYS] suggested control**: Suggested control signal for the error

### SysCon Configuration Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `system-conditional-enable` | boolean | false | Enable System Conditional analysis |
| `system-conditional-step-count` | int | - | Max steps before giving up |
| `checkLoopDepth` | int | 1 | Loop detection depth (negative to deactivate) |
| `analogMode` | boolean | false | Use H, L, Z, X for non-top-pin nets |
| `monoValUseZ` | boolean | false | Nets with only H or L also checked with Z |

---

## Version History

| Version | Feature |
|---|---|
| **3.4.0** | Initial Dynamic System Conditional |
| **3.5.0** | SysConOpt options (checkLoopDepth, analogMode, monoValUseZ) |
| **3.5.1** | Causality Query API, enhanced synoptic schematic integration |
| **3.5.2** | System Conditional results visible in synoptic schematic |

---

*This documentation is based on Confluence pages from the Aniah project, including contributions from Mehdi Khosravian (Research lead), Hermann Gioja (Tech lead), Diego Rousselin (A.E. lead), Pierre-Charles Pallin, and Vincent Sidot.*

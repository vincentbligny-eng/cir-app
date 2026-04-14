# OneCheck PDK Documentation

## Process Design Kit (PDK) Integration & Technology Configuration

**Version:** OneCheck 3.6.x
**Last updated:** March 2026
**Audience:** Application Engineers, EDA Integrators, OneCheck Users

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technologies.csv File](#2-technologiescsv-file)
3. [Primitive Recognition & Device Mapping](#3-primitive-recognition--device-mapping)
4. [Device Parameters Extraction (W, L, nfin)](#4-device-parameters-extraction-w-l-nfin)
5. [Device Size Limits](#5-device-size-limits)
6. [XDevice Support & Mapping](#6-xdevice-support--mapping)
7. [Forbidden & Unpreferred Cells](#7-forbidden--unpreferred-cells)
8. [Heuristics & Technology Setup Automation](#8-heuristics--technology-setup-automation)
9. [Trigger Warnings from Heuristics](#9-trigger-warnings-from-heuristics)
10. [Netlist Format Support (CDL / HSpice)](#10-netlist-format-support-cdl--hspice)
11. [Detection Conditions Reference](#11-detection-conditions-reference)
12. [Integrity Checks](#12-integrity-checks)
13. [Diode-Mounted Transistor Detection](#13-diode-mounted-transistor-detection)
14. [Power Functions & Supply Detection](#14-power-functions--supply-detection)
15. [Sandboxed API for Custom PDK Checks](#15-sandboxed-api-for-custom-pdk-checks)
16. [System Conditional (SysCon) API in Heuristics](#16-system-conditional-syscon-api-in-heuristics)

---

## 1. Overview

The **Process Design Kit (PDK)** configuration in OneCheck defines how the tool recognizes and classifies transistor-level primitives from a circuit netlist. It is the bridge between the foundry-specific technology description and OneCheck's electrical rule checking (ERC) engine.

The PDK setup involves:

- **Technology file (`technologies.csv`)**: Maps device names (models) from the netlist to primitive types recognized by OneCheck (NMOS, PMOS, resistor, capacitor, diode, etc.).
- **Parameter extraction**: Reads electrical parameters (W, L, nfin, etc.) from the CDL or HSpice netlist for each device.
- **Ratings and limits**: Defines min/max values for parameters like width, length, and voltage ratings used by EOS (Electrical Overstress) and Device Size Limits checks.
- **Heuristics**: JavaScript-based automation that pre-fills or adjusts the technology setup based on netlist content, reducing manual configuration effort.
- **XDevice mapping**: Handles non-standard or customer-specific device types that don't match standard primitive categories.

---

## 2. Technologies.csv File

The `technologies.csv` file is the central PDK configuration file in OneCheck. It defines the mapping between device model names found in the netlist and the OneCheck primitive types.

### Structure

The file is a CSV with the following core columns:

| Column | Description |
|--------|-------------|
| `device` | The model name as it appears in the netlist (e.g., `nch`, `pch`, `nmos_3p3`, `pmos_1p8`) |
| `primitive` | The OneCheck primitive type: `nmos`, `pmos`, `npn`, `pnp`, `resistor`, `capacitor`, `diode`, `inductor` |
| `max_rating` | Maximum voltage rating for EOS checks (in Volts) |
| `w_min` | Minimum width rating (for Device Size Limits) |
| `w_max` | Maximum width rating |
| `l_min` | Minimum length rating |
| `l_max` | Maximum length rating |
| `<param>_min` / `<param>_max` | Custom parameter ratings (user-defined) |

### Key Rules

- The `device` column must match the model name exactly as it appears in the `.subckt` or instance declaration in the netlist.
- The `primitive` column determines how OneCheck treats the device during TED (Transistor-level Electrical Detection) analysis.
- Ratings columns (`w_min`, `w_max`, `l_min`, `l_max`, custom) are used only when the corresponding error function is selected (e.g., "Device Size Limits" or "Electrical Overstress").
- If a rating column is defined in `technologies.csv` but the corresponding parameter is missing from the netlist CDL description, a warning is triggered.

### Example

```csv
device,primitive,max_rating,w_min,w_max,l_min,l_max
nch,nmos,1.8,120e-9,10e-6,20e-9,1e-6
pch,pmos,1.8,120e-9,10e-6,20e-9,1e-6
nch_hvt,nmos,3.3,240e-9,20e-6,40e-9,2e-6
pch_hvt,pmos,3.3,240e-9,20e-6,40e-9,2e-6
rpoly,resistor,,,,
mimcap,capacitor,,,,
ndio,diode,,,,
```

---

## 3. Primitive Recognition & Device Mapping

OneCheck classifies every component in the netlist into **primitive types**. The recognition process works as follows:

### Standard Primitives

| Letter Prefix | Primitive Type | Description |
|---------------|---------------|-------------|
| `M` | MOSFET (NMOS/PMOS) | MOS transistors - channel type determined by technology |
| `Q` | Bipolar (NPN/PNP) | Bipolar junction transistors |
| `R` | Resistor | Passive resistive elements |
| `C` | Capacitor | Passive capacitive elements |
| `D` | Diode | PN junction diodes |
| `L` | Inductor | Inductive elements |
| `J` | JFET | Junction field-effect transistors |
| `X` | Subcircuit instance | Hierarchical subcircuit instantiation |

### Channel Recognition

For MOSFET devices (`M` prefix), the channel type (N or P) is determined by matching the model name against the `device` column in `technologies.csv`. This is critical because:

- **NMOS** and **PMOS** have fundamentally different electrical behaviors
- The channel type determines which error conditions apply (e.g., bulk leakage polarity, gate-to-supply checks)
- Heuristics can auto-detect channel type from model name patterns (e.g., names containing `n`, `nch`, `nmos` for N-channel)

### Wahoo Statistics

After parsing, OneCheck computes **Wahoo statistics** per subcircuit: counts of each primitive type (NMOS, PMOS, resistors, etc.). These statistics are used for:

- Pre-analysis complexity estimation
- TED coverage optimization
- Smart clustering categorization (CMOS Parameters vs. Passive Components)

---

## 4. Device Parameters Extraction (W, L, nfin)

### CDL Parameter Extraction

For every transistor in the circuit, size information is extracted from the netlist file (CDL or HSpice):

- **W (Width)** and **L (Length)** are mandatory parameters for MOSFET devices. If missing and a size-related error check is enabled, an error message is triggered:
  > "Missing required parameter: W or L in CDL file. Ensure all transistors include both W (width) and L (length) before proceeding."

- **nfin (Number of Fins)**: In FinFET processes, `nfin` replaces `W` as the width parameter. All fins have the same width by construction; a wider transistor uses more fins. `W` and `nfin` are interchangeable depending on the detected parameter.

  > **Note:** `nfin` (number of fins) must not be confused with `nf` (number of fingers). These are different physical parameters.

### Unit Support

For each extracted parameter, the unit of measurement must be explicitly defined. Supported unit prefixes:

| Prefix | Scale | Example |
|--------|-------|---------|
| `m` | milli (10^-3) | 1m = 1 millimeter |
| `u` | micro (10^-6) | 1u = 1 micrometer |
| `n` | nano (10^-9) | 1n = 1 nanometer |

Values also support scientific notation (e.g., `1.2e-9` for 1.2 nm).

Any mismatch or absence of a unit triggers an error to prevent incorrect validation results.

### Custom Parameters

Any parameter defined in the CDL file can be added for verification, as long as:

1. The parameter name exists in the netlist description
2. At least one associated rating (min or max) is defined in `technologies.csv`

Examples of custom parameters: `nf` (number of fingers), `m` (multiplier), `cox` (oxide capacitance), etc.

### Parallel-Series Reduction Impact

When **parallel-series reduction** is enabled ("Apply reduction"), device size ratings are applied **after** components are merged. For FinFET processes, `nfin` replaces `W` in the reduction formulas.

---

## 5. Device Size Limits

The **Device Size Limits** feature is a dedicated error function that validates transistor dimensions against user-defined constraints.

### Enabling the Feature

1. In **Global Configuration**, select the "Device Size Limits" error function
2. In the **Technologies** tab, ensure min/max rating columns exist for the parameters to check

### Configuration in Technologies.csv

When "Device Size Limits" is selected, `technologies.csv` must contain rating columns:

| Column | Description |
|--------|-------------|
| `w_min` | Minimum width (or min number of fins for FinFET) |
| `w_max` | Maximum width (or max number of fins for FinFET) |
| `l_min` | Minimum length |
| `l_max` | Maximum length |

If these columns are missing, they are **automatically added** to the technologies tab. However:

- Missing values in auto-added columns trigger an **error**
- If at least one rating is defined per parameter but the complementary rating is missing, a **warning** is triggered

### Error Reporting

Devices that violate size limits are flagged with the following information format:

> "Parameter **<param_name>** = **<value>** **<is below/exceeds>** **<min/max>** rating **<value>** for **<device_name>**"

Error report fields:
- **Category**: CMOS Parameters or Passive Components
- **Cell**: Name of the cell containing the violating component
- **Properties**: Parameter values of the component
- **PDK**: Device name and associated limit constraints
- **Path**: Instance name(s) where the component is located

### Adding Custom Parameter Ratings

A button named **"Add new parameters ratings"** in the Technologies tab allows adding ratings for any CDL parameter:

1. Click "Add new parameters ratings" (available only when Size Limits is selected)
2. Enter the exact parameter name (case-insensitive)
3. Two columns are created: `<param>_min` and `<param>_max`
4. If the parameter is not found in the CDL file, an error is triggered
5. Column names can be renamed after creation (e.g., `m_min` to `m_parameter_rating`)

---

## 6. XDevice Support & Mapping

**XDevices** are subcircuit instances (`X` prefix) that represent technology-specific cells not directly recognized as standard primitives. They are common in advanced foundry PDKs where devices like ESD clamps, decoupling cells, or custom I/O structures are provided as black-box subcircuits.

### Mapping Mechanism

OneCheck heuristics attempt to automatically map XDevices to known primitive types by:

1. Analyzing the subcircuit pin names and count
2. Matching against known patterns (e.g., 4-pin subcircuits with gate/drain/source/bulk naming → MOSFET)
3. Using the `technologies.csv` device column for explicit mappings

### Fallback Behavior

If a suitable mapping cannot be found, the heuristic replaces the mapping with `@empty`. This unblocks the analysis but may produce incorrect results. The **trigger warning mechanism** (see Section 9) is designed to alert the user about such uncertain mappings.

---

## 7. Forbidden & Unpreferred Cells

The **Forbidden & Unpreferred Cells** feature allows users to flag specific library cells as design violations.

### Concept

- **Forbidden cells**: Cells that must not be used in the design under any circumstances. Their presence triggers an error.
- **Unpreferred cells**: Cells that are discouraged but tolerated. Their presence triggers a warning.

### Configuration

The forbidden/unpreferred cell lists are defined via JavaScript heuristic code that runs during the setup phase. This allows dynamic rules based on:

- Cell name patterns (regex matching)
- Technology node constraints
- Customer-specific design rules

### Implementation

The feature hooks into the PDK setup flow:

1. After netlist parsing, all instantiated cells are enumerated
2. The heuristic code checks each cell against the forbidden/unpreferred lists
3. Matches are reported in the error reporting tab under a dedicated category
4. Results can be grouped and filtered in Smart Clustering view

### Use Case

A typical use case is a foundry requiring designers to avoid deprecated cells in newer process revisions. The forbidden cells list can be updated per technology node and automatically checked during every OneCheck run.

---

## 8. Heuristics & Technology Setup Automation

**Heuristics** are JavaScript code files that automate the PDK setup process. They run in a sandboxed environment during the configuration phase, before the main analysis starts.

### Purpose

Heuristics solve two problems:
1. **Speed**: Do the setup quickly by auto-filling technology parameters
2. **Correctness**: Set up correctly by applying technology-specific rules

### Capabilities

Heuristics can:

- Read and modify the `technologies.csv` content programmatically
- Auto-detect NMOS/PMOS channel types from model naming conventions
- Map XDevice subcircuits to known primitives
- Set voltage ratings from PDK documentation
- Define power detection thresholds
- Add custom parameter columns
- Flag forbidden or unpreferred cells
- Trigger warnings or errors via `@warning` / `@error` tags

### Execution Context

Heuristics run in a **sandboxed JavaScript environment** with access to over 40 API methods (see Section 15). The sandbox isolates user code from the main application process, preventing:

- Unauthorized file system access
- License server bypass
- Application state corruption

### Technology Code Pattern

A typical heuristic file follows this pattern:

```javascript
// Auto-detect channel type from model name
const device = api.getTechnology(primitive, modelName);
if (modelName.includes('nch') || modelName.includes('nmos')) {
    // Map as NMOS
} else if (modelName.includes('pch') || modelName.includes('pmos')) {
    // Map as PMOS
}

// Set voltage ratings from PDK data
// Set W/L limits based on technology node
```

---

## 9. Trigger Warnings from Heuristics

### Problem Statement

Currently, heuristics can modify the PDK and power setup, but there is no mechanism to mark a modification as potentially incorrect or uncertain. When a heuristic makes an uncertain decision (e.g., XDevice mapping fallback), the user is never warned.

### Solution: @warning / @error Tags

A mechanism allows heuristics to create warnings, similar to how missing PDK information creates warnings:

- **`@warning` tag**: Creates a non-blocking alert displayed in the interface. The analysis continues, but the user is notified of the uncertain value.
- **`@error` tag**: Creates a blocking alert that prevents the analysis from proceeding until resolved.

### Implementation

- Tags are defined in cells of the technology configuration
- They are **not** passed to the C computation layer
- They are interpreted by the front-end (GUI/Worker) to trigger appropriate messages in the interface

### Use Case: XDevice Mapping

When an XDevice mapping cannot be confidently determined:

1. The heuristic sets a best-guess mapping
2. A `@warning` tag is attached to the cell
3. The user sees the warning in the Technologies tab
4. The user can validate or correct the mapping before proceeding

This minimizes friction between app launch and result page -- an important UX consideration since execution speed and first-impression quality are competitive factors.

---

## 10. Netlist Format Support (CDL / HSpice)

OneCheck supports two primary netlist dialects for PDK integration:

### CDL (Circuit Description Language)

The default netlist format. CDL files (`.cdl`) follow Cadence's syntax for describing hierarchical circuits with `.subckt` / `.ends` blocks.

### HSpice

HSpice netlists (`.cir`, `.sp`, `.spi`) are supported for customers whose design flow is built around Synopsys HSpice or similar SPICE simulators.

#### Key Differences from CDL

| Feature | CDL | HSpice |
|---------|-----|--------|
| File extensions | `.cdl` | `.cir`, `.sp`, `.spi` |
| First line | Part of netlist | Title (ignored) |
| Top-level circuit | Explicit `.subckt` | Implicit (outside `.subckt` blocks) |
| Simulation commands | Not present | Present but ignored by OneCheck |
| Parameter expressions | Static values | May contain functions (`.param`) |
| End markers | `.ends` | `.ends`, `.eom`, `.EOM`, `.end`, `.END` |

#### Supported HSpice Commands

| Command | Action |
|---------|--------|
| `.SUBCKT` / `.subckt` | Retained - subcircuit definition start |
| `.ENDS` / `.ends` / `.EOM` / `.eom` | Retained - subcircuit definition end |
| `.END` / `.end` | Stops netlist parsing |
| `.GLOBAL` | Retained - global node definitions |
| `.MODEL` | Retained - device model information |
| `.INCLUDE` | Retained - file inclusion |
| `.LIB` | Converted to `.INCLUDE` (path only, labels removed) |
| `.ALTER` | Stops netlist parsing (treated as `.END`) |
| `.TRAN`, `.DC`, `.AC`, `.PARAM`, `.PRINT`, `.PROBE`, `.option`, `.control`, `.op` | Ignored |

#### Supported Component Prefixes

Retained: `J`, `M`, `Q`, `R`, `X`, `L`, `C`, `D`
Ignored: `E`, `F`, `G`, `H`, `I`, `K`, `P`, `S`, `T`, `Y`, `U`, `W`

#### Voltage Sources

Lines starting with `V` are verified but ignored for circuit topology. Supplies are detected from circuit description, not from voltage source declarations. Voltage source commands (`PWL`, `PULSE`, `SINE`, `AC`, `EXP`, `SFFM`) are not supported.

#### Parameter Resolution

`.PARAM` statements define parameters used in component values. OneCheck handles them as follows:

- Static values (e.g., `.param ResParam = 10k`) are resolved directly
- Expressions with functions (e.g., `.param a(x,y) = '2*sqrt(V(p,n))'`) trigger a warning; the user must provide a static value
- If parameter resolution fails, a permissive fallback is used with warnings

### Netlist Format Selector (>= v3.6.0)

Starting from v3.6.0, the netlist format is selected via a dedicated **"Netlist format"** dropdown in the Global Configuration tab, replacing the previous "HSpice compatibility mode" checkbox.

**CLI options:**
- `--netlists <file>` : Path to the netlist file(s) (replaces `--cdl`)
- `--netlist-format <format>` : `cdl` or `hspice` (replaces `--spice`)

**Behavior:**
- CDL format + CDL file: Normal analysis
- CDL format + HSpice file: Parsing error (format mismatch)
- HSpice format + HSpice file: HSpice parser activated
- HSpice format + CDL file: Works (HSpice parser is an extension of CDL parser)

---

## 11. Detection Conditions Reference

The following table lists all error types that OneCheck can detect, many of which depend on correct PDK configuration (device types, voltage ratings, channel recognition):

| Error Type | Detection Condition | PDK Dependency |
|------------|-------------------|----------------|
| **Bulk Leakage** | Source/Drain supply > 0.2V above bulk supply | NMOS/PMOS recognition |
| **Diode Leakage** | Forward-biased diode (V(P,N) > 0.2V threshold) | Diode primitive mapping |
| **EOS (MOSFET)** | Voltage exceeds max_rating on all terminal pairs | `max_rating` in technologies.csv |
| **EOS (Cross Domain)** | Voltage exceeds max_rating on Gate/Source (PMOS) | PMOS recognition + `max_rating` |
| **EOS (Bipolar)** | V(B,E) or V(C,B) exceeds max_rating | Bipolar recognition + `max_rating` |
| **EOS (Diode)** | V(P,N) exceeds max_rating | Diode recognition + `max_rating` |
| **EOS (Resistor)** | V(P,N) exceeds max_rating | Resistor recognition + `max_rating` |
| **EOS (Capacitor)** | V(P,N) exceeds max_rating | Capacitor recognition + `max_rating` |
| **Floating Bulk** | Undriven/unconnected transistor bulk terminal | NMOS/PMOS recognition |
| **Floating Diode** | Undriven diode (physical or electrical) | Diode recognition |
| **Floating Gate** | No voltage on gate + S/D connected to power/ground | NMOS/PMOS recognition |
| **Gate to Supply** | Gate directly connected to power/ground | NMOS/PMOS recognition |
| **HiZ** | High-impedance conditional state on gate causing leakage | Full PDK setup (TED analysis) |
| **Missing Isolation** | Signal crossing from off power domain to active domain | Power domain configuration |
| **Missing Level Shifter** | Signal crossing voltage domains without isolation cell | Voltage domain configuration |
| **Nwell-to-Psub Leakage** | PMOS bulk below -0.6V causing N-well leakage | PMOS recognition |
| **Device Size Limits** | W, L, or custom param outside min/max ratings | Size ratings in technologies.csv |
| **Diode-Mounted Transistor** | Transistor with gate tied to drain/source | NMOS/PMOS recognition |

---

## 12. Integrity Checks

**Integrity checks** verify the electrical interface specification of a block against its actual implementation. This feature was developed in collaboration with Nvidia and aligns with Insight's "interface checks".

### Pin Specification

All pins of a top-level block can be specified with the following properties:

| Property | Values | Description |
|----------|--------|-------------|
| `cell` | subckt name | Name of the subcircuit |
| `net_name` | net name | Name of the net |
| `type` | `input`, `output`, `supply`, `ground`, `supply_output` | Pin functional type |
| `voltages` | list of values | Allowed voltage values or references |
| `dependencies` | supply references | Power domain dependencies |

### Error Categories

The integrity check produces 10 error categories:

1. **False Input** - Input pin connected as supply/ground
2. **Undriven Output** - Output pin connected as supply/ground
3. **Unspecified Input/Output** - No voltage value for input/output pin
4. **Unspecified Supply-Out** - No voltage value for supply-output pin
5. **Mismatch Input/Output** - Pin connected to wrong supply/ground vs. specification
6. **Mismatch Supply-Out** - Supply-output connected to wrong voltage source
7. **Unused Power/Ground** - Supply pin not powering any device
8. **Unused Supply-Output** - Supply-output pin not utilized
9. **No Specification for Circuitry** - Pin exists but not defined in power setup
10. **Malformed Specification** - Improperly defined pin (excessive supplies, mismatched voltages)

### PDK Relationship

Integrity checks depend on correct PDK setup because:
- Pin type classification relies on correct primitive recognition (which transistors are connected to which pins)
- Supply propagation requires correct power/ground identification
- The N-Pole inheritance mechanism uses technology-aware bag connectivity

---

## 13. Diode-Mounted Transistor Detection

OneCheck detects transistors configured as diodes (gate tied to drain and/or source), which can indicate design issues.

### Detection Method

A transistor is considered **diode-mounted** if its gate has a direct dependency on its own drain and/or source:

| Connection | Input Side | Output Side | Flag |
|-----------|-----------|-------------|------|
| D <-> G | Drain | Source | `DMT_DRAIN` |
| S <-> G | Source | Drain | `DMT_SOURCE` |
| D <-> G <-> S | Drain & Source | - | `DMT_DRAIN + DMT_SOURCE` |

Detection runs during the **TED pre-analysis step**.

### Reporting Rules

- Transistors with **both** `DMT_DRAIN` and `DMT_SOURCE` flags are treated as resistors (not reported)
- **PMOS**: Reported if effective propagation from input to gate and gate is HIGH
- **NMOS**: Reported if effective propagation from gate to input and gate is LOW
- Gate directly connected to power (supply or ground) → not reported

### Error Format

The root-cause string lists the hierarchical path from TED-top to the diode-mounted transistor:

```
Xmux0 @mux4 [Xmux1 @mux2 [M0 ] ]
```

This means: transistor `M0` in instance `Xmux1` (type `mux2`) within instance `Xmux0` (type `mux4`).

### PDK Dependency

- Correct NMOS/PMOS channel recognition is required for proper reporting polarity
- The feature must be explicitly selected in Global Configuration ("Transistor mounted as diode")
- Results appear as a dedicated NPole category "DMT"

---

## 14. Power Functions & Supply Detection

Power functions in OneCheck handle the detection, propagation, and resolution of power supply domains throughout the circuit hierarchy.

### Power Specification Resolution (PSR)

PSR computes all valid power scenarios from the user-defined power setup. It uses the Cartesian product of supply voltage values to enumerate all possible operating modes.

### Supply Types

| Type | Bit Flag | Propagation | Description |
|------|----------|-------------|-------------|
| `supply` | `NST_SUPPLY` | Downward | VDD power rail |
| `ground` | `NST_GROUND` | Downward | GND rail |
| `input` | `NST_INPUT` | None (registered at definition) | Input signal pin |
| `output` | `NST_OUTPUT` | None (registered at definition) | Output signal pin |
| `supply-output` | `NST_OUTPUT \| NST_SUPPLY` | Downward (supply part) | Regulated output |

### Power Detection Threshold

The power detection threshold determines the minimum voltage difference required to distinguish a power rail from a signal net. This is configurable per technology and affects:

- Bulk leakage detection (0.2V default threshold)
- Diode forward-bias detection
- Cross-domain voltage analysis

### Supply Propagation

Supplies are propagated top-down through the hierarchy:
1. User defines supplies at the top level via `power.csv`
2. Propagation follows instance pins, matching net names to supply definitions
3. At each level, supply conflicts are detected and reported
4. `input` and `output` types are **not propagated** -- they are registered only at their definition level

---

## 15. Sandboxed API for Custom PDK Checks

Custom PDK checks can be implemented using the sandboxed JavaScript API. The sandbox provides over 40 methods organized into four namespaces.

### Core API (`api.*`)

Key methods for PDK-related operations:

| Method | Description |
|--------|-------------|
| `api.getTop()` | Get the name of the top subcircuit |
| `api.fetchSubckt(subckt)` | Fetch subcircuit content (instances, nets, primitives) |
| `api.fetchInstance(subckt, instance)` | Fetch instance content |
| `api.getTechnology(primitive, device)` | Get PDK information for a primitive/device pair |
| `api.getWahoos(subckt)` | Get primitive statistics per subcircuit |
| `api.getSubckts()` | Enumerate all subcircuits under top |
| `api.getSubcktPins(subckt)` | Get pin list of a subcircuit |
| `api.getSubcktStats()` | Get overall subcircuit statistics |
| `api.getXdevices()` | Get XDevice mappings |
| `api.getParameterValues(query)` | Get parameter values for device leaves in hierarchy |
| `api.getDefinedSupplies()` | Enumerate all defined supplies |
| `api.getPropagatedSupplies()` | Enumerate all propagated supplies |
| `api.getSupplies()` | Get all recognized supplies |
| `api.getBags(subckt, color)` | Get colored bags (connectivity groups) |
| `api.getNetsRelationship(relations)` | Check relationships between net pairs |
| `api.getNetsSupplyOrigins(subckt, nets)` | Get supply contexts for nets |
| `api.getNPoles(subckt)` | Get all NPoles in a subcircuit |
| `api.getNPoleRootCauses(queries)` | Get root causes for NPole errors |
| `api.getShorts(subckt, netId)` | Get shorted net names |
| `api.getUnconnectedPins()` | Get unconnected pins by subcircuit |
| `api.getFollowedPowerNets(subckt)` | Get followed power nets |

### Powers API (`powers.*`)

| Method | Description |
|--------|-------------|
| `powers.addPower(cell, net, type, voltages, dependency)` | Add a power definition |
| `powers.addDiscardedPowerScenario(...)` | Discard a specific power scenario |

### Log API (`log.*`)

| Method | Description |
|--------|-------------|
| `log.information(message)` | Log an informational message |
| `log.warning(message)` | Log a warning |
| `log.error(message)` | Log an error |

### Options API (`options.*`)

| Method | Description |
|--------|-------------|
| `options.get(option)` | Get a configuration option value |

### Advanced APIs

| Method | Description |
|--------|-------------|
| `api.buildHiZMesh(subckt, config, path)` | Build HiZ mesh for TED analysis |
| `api.browseHiZMesh(sessionId, level, variation)` | Browse HiZ mesh states |
| `api.destroyHiZMesh(sessionId)` | Close HiZ mesh session |
| `api.getTedPreAnalysisResults()` | Get TED pre-analysis statistics |
| `api.getTedBestComplexity()` | Get optimal TED complexity hint |
| `api.getSynopticSchematicData(rootCause, rootCauses)` | Get synoptic schematic for cross-probing |
| `api.getInstanciationTree()` | Get full instantiation tree |
| `api.getProfilerStats()` | Get performance profiling data |

---

## 16. System Conditional (SysCon) API in Heuristics

The **System Conditional (SysCon)** module post-processes errors to determine if conditions are possible at the system level. It uses the Z3 SMT solver to prove or disprove error conditions.

### Applicability

SysCon applies to:
- Conditional HiZ errors
- Conditional Leakage errors
- Isolation cell conditions
- Analog PowerDown (Conditional HiZ + Leakage with upstream current reference off)
- Voltage-based error propagation paths

### SAT/UNSAT Semantics

| Result | Condition | Meaning | Conclusion |
|--------|-----------|---------|------------|
| SAT | From HiZ | Error can be true | Check model vs. setup |
| UNSAT | From HiZ | Error must be false | Conclusive (no false negative) |
| SAT | Not(From HiZ) | Error can be false | Check model vs. setup |
| UNSAT | Not(From HiZ) | Error must be true | Conclusive (no false positive) |
| SAT | From HiZ + power setup | Error is true | Conclusive |
| UNSAT | From HiZ + power setup | Error is false | Conclusive |
| SAT | Not(From HiZ) + power setup | Error may be false | Inconclusive |
| UNSAT | Not(From HiZ) + power setup | Error must be true | Conclusive |

### Workflow

1. TED outputs a condition (e.g., `A=L, B=L, C=L, VDD=H, VDDL=L`)
2. Variables directly in setup are classified as **invariants**; others are **variants**
3. SysCon checks `Not(condition)` for each variant individually
4. If any variant check is SAT → error can be false (some operating mode avoids it)
5. If all are UNSAT → error must be true
6. If inconclusive, SysCon refines using power scenarios (Cartesian product of setup-variant combinations)

### PDK Relationship

SysCon depends on correct PDK setup because:
- Supply voltage values determine invariant/variant classification
- Power scenario enumeration uses `technologies.csv` voltage ratings
- Signal propagation paths rely on correct primitive recognition and connectivity

---

## Appendix A: File Reference

| File | Location | Purpose |
|------|----------|---------|
| `technologies.csv` | Project input directory | Device-to-primitive mapping, voltage ratings, size limits |
| `power.csv` | Project input directory | Power domain specification (supplies, grounds, I/O) |
| `config.json` | Project root | Global configuration (error functions, netlist path, format) |
| `heuristics/*.js` | Heuristics directory | Custom PDK setup automation scripts |
| `*.cdl` | User-specified | CDL netlist file |
| `*.sp`, `*.cir`, `*.spi` | User-specified | HSpice netlist file |

## Appendix B: CLI Options Reference (PDK-related)

| Option | Description | Default |
|--------|-------------|---------|
| `--netlists <path>` | Path to netlist file(s) | `./project.cdl` |
| `--netlist-format <format>` | Netlist format: `cdl` or `hspice` | `cdl` |
| `--restrict-tests-to <test>` | Run only specific error function | All enabled |
| `-cl` | Command-line mode (no GUI) | GUI mode |
| `-c <path>` | Configuration file path | `./config.json` |

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **PDK** | Process Design Kit - foundry-specific technology description |
| **CDL** | Circuit Description Language - Cadence netlist format |
| **TED** | Transistor-level Electrical Detection - OneCheck's core DFS analysis engine |
| **NPole** | Abstract representation of interconnected component groups in the circuit graph |
| **EOS** | Electrical Overstress - voltage rating violation |
| **ERC** | Electrical Rule Checking |
| **DMT** | Diode-Mounted Transistor |
| **SysCon** | System Conditional - SAT-based analysis module using Z3 |
| **PSR** | Power Specification Resolution |
| **Wahoo** | Primitive statistics per subcircuit |
| **XDevice** | Non-standard subcircuit instance requiring explicit mapping |
| **Bag** | Connectivity group linking nets across hierarchy |
| **FinFET** | Fin Field-Effect Transistor - advanced process node architecture |
| **nfin** | Number of fins in FinFET process (width equivalent) |
| **nf** | Number of fingers (parallel gate structures) |
| **HiZ** | High-impedance state |
| **Smart Clustering** | Intelligent error grouping by root causes |

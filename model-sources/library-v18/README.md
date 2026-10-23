# Approved October model library additions

All archived meshes use millimetres, Z-up, in **assembly** coordinates. They are not slicing orientations. Source designs are retained unmodified; this export only simplifies preview tessellation under the existing 0.06 mm sampled/bounds-error gates, retaining closed topology.

Sources:

- Three-step stairs: task `01a147b3-0047-7d11-99a4-6b8dd67d5bcc`, `rounded-stairs` and latest `spiral-corner-stairs`. Six variants: straight/left/right × 83.4/85.6 mm.
- Milk-candy houses: task `01a147b7-ae04-7911-8843-706d63cd0096`, latest `stackable-houses-v2`. Two 196 × 96 mm houses and one 196 × 196 mm two-room house, all 83.4 mm high. Roof receiver revision also updates LHR and SHR without changing their assembly dimensions or stored color keys.
- Bridge: task `01a14801-1b0e-7b43-b3ac-9f17af10ecd5`, latest `magnetic-sag-bridge/mesh.json`. 164 × 96 mm, sag 6 mm, four magnets at a 120 × 80 mm rectangle. The side-standing print STL is deliberately not used.
- Pokémon Center: task `01a14847-54c6-7b83-bac8-e1fa4a733ef0`, `pokemon-center-restored/scene.json`. Four actual downward magnet contacts; two physical pieces with seven independently editable color regions. Existing stock colors represent white/red/cyan/dark as white/red/sky/black.

`manifest.json` records source paths, assembly bounds, simplification checks and exported GLB SHA-256 hashes. Each `<group>-<component>.npz` contains the source vertices/faces. `roof-receivers.json` is the source designer's roof hardware report.

Regenerate preview geometry without external source directories:

```sh
python3 scripts/prepare-library-v18.py --from-archive
```

To reimport updated original designs from the sibling `bambu-output` folder, omit `--from-archive`. Product data is in `src/data/library-v18.json` and its minitool copy. Products append to existing serialized indices.

The bridge requires two distinct coplanar roofs, two contacts at each end, four total contacts, and collision-free sag clearance. Removing either support removes its dependent bridge. Moving a support is rejected if the complete assembly would become unsupported. Secondary supports are derived from geometry rather than introducing incompatible persisted-code fields.

Prices (CNY): stairs 14; milk-candy left/right 29; two-room 49; bridge 8; Pokémon Center 89. Source physical fit/load testing remains separate from website placement validation.

/-
Model of the delivery feature map's reach and retire semantics, and a proof of property P1:
retiring a feature leaves every other feature's reach unchanged.

Follows (plugins/delivery):
  scripts/lib/codemap.js   `reach`       the breadth-first walk and the document rule
  scripts/lib/features.js  `retirement`  exclusive = reached by the feature and by no other

What the model keeps
  * a finite file graph: a list of edges (from, to) over files named by natural numbers;
  * which files are documents;
  * a feature as its list of anchors;
  * the document rule: a file's edges are followed when it is an anchor of the walk or when it is
    not a document. A document reached from another file ends its chain.

What the model abstracts, so the proof says nothing about it
  * how edges are found (import rules, the mention rule, path resolution). Edges are given.
  * deletion is modelled as removing every edge that touches a deleted file and every deleted
    anchor. It assumes a surviving reference still resolves to the same file after the deletion.
  * hop counts, chains and evidence lines: only the reached set is modelled.
  * the "named by a file the feature does not reach" filter of `retirement`. It only shrinks the
    deletable set, and the theorem holds for any subset of the exclusive files.
  * blind files. A file no rule reads has no edges here, as in the code.

The proof is about this model. `Model/Examples.lean` and `scripts/retire-property.test.js` are
what tie the model to the code.
-/
namespace FeatureMap

abbrev File := Nat

structure Graph where
  edges : List (File × File)
  docs : List File

/-- A file's edges are followed when it is a start of the walk or is not a document. -/
def expands (g : Graph) (starts : List File) (a : File) : Prop :=
  a ∈ starts ∨ a ∉ g.docs

/-- `codemap.reach`: the files reached from `starts`. -/
inductive Reach (g : Graph) (starts : List File) : File → Prop
  | start {f : File} : f ∈ starts → Reach g starts f
  | step {a b : File} : Reach g starts a → expands g starts a → (a, b) ∈ g.edges →
      Reach g starts b

/-- Deleting the files in `D`: every edge touching one of them goes. -/
def Graph.remove (g : Graph) (D : List File) : Graph :=
  { edges := g.edges.filter (fun e => decide (e.1 ∉ D ∧ e.2 ∉ D)), docs := g.docs }

/-- Deleting the files in `D` from a feature's anchors. -/
def removeFiles (D : List File) (starts : List File) : List File :=
  starts.filter (fun f => decide (f ∉ D))

/-- `features.retirement`: reached by the feature `F` and by none of the `others`. -/
def Exclusive (g : Graph) (F : List File) (others : List (List File)) (x : File) : Prop :=
  Reach g F x ∧ ∀ G, G ∈ others → ¬ Reach g G x

/-- Deleting files a walk does not reach leaves that walk's reach unchanged. -/
theorem reach_remove_of_disjoint (g : Graph) (starts D : List File)
    (h : ∀ x, Reach g starts x → x ∉ D) (x : File) :
    Reach (g.remove D) (removeFiles D starts) x ↔ Reach g starts x := by
  constructor
  · intro hx
    induction hx with
    | start hf =>
      exact Reach.start (List.mem_filter.mp hf).1
    | step _ hexp hedge ih =>
      refine Reach.step ih ?_ (List.mem_filter.mp hedge).1
      cases hexp with
      | inl hs => exact Or.inl (List.mem_filter.mp hs).1
      | inr hd => exact Or.inr hd
  · intro hx
    induction hx with
    | start hf =>
      exact Reach.start (List.mem_filter.mpr ⟨hf, by simpa using h _ (Reach.start hf)⟩)
    | step ha hexp hedge ih =>
      have hb := h _ (Reach.step ha hexp hedge)
      have haD := h _ ha
      refine Reach.step ih ?_ (List.mem_filter.mpr ⟨hedge, by simpa using And.intro haD hb⟩)
      cases hexp with
      | inl hs => exact Or.inl (List.mem_filter.mpr ⟨hs, by simpa using haD⟩)
      | inr hd => exact Or.inr hd

/-- P1. Deleting any of a retired feature's exclusive files leaves the reach of every other
feature unchanged. `D` is any list of exclusive files, so it covers both the whole exclusive set
and the smaller "deletable" list the code prints. -/
theorem retire_preserves_reach (g : Graph) (F : List File) (others : List (List File))
    (D : List File) (hD : ∀ x, x ∈ D → Exclusive g F others x)
    (G : List File) (hG : G ∈ others) (x : File) :
    Reach (g.remove D) (removeFiles D G) x ↔ Reach g G x :=
  reach_remove_of_disjoint g G D (fun y hy hyD => (hD y hyD).2 G hG hy) x

/-! ## An executable reach, used only to certify fixed examples

`reachList` is a fuelled closure. Only its soundness is proved in general. An example's expected
set is certified equal to `Reach` by checking two things by evaluation: the set is closed under
the walk (so it contains `Reach`), and each member is produced by `reachList` (so `Reach` contains
it). No claim is made that `reachList` is complete for every graph. -/

def expandsB (g : Graph) (starts : List File) (a : File) : Bool :=
  starts.contains a || !g.docs.contains a

def round (g : Graph) (starts cur : List File) : List File :=
  cur ++ (g.edges.filter (fun e => cur.contains e.1 && expandsB g starts e.1)).map (·.2)

def reachN (g : Graph) (starts : List File) : Nat → List File
  | 0 => starts
  | n + 1 => round g starts (reachN g starts n)

def reachList (g : Graph) (starts : List File) : List File :=
  reachN g starts g.edges.length

theorem expandsB_iff (g : Graph) (starts : List File) (a : File) :
    expandsB g starts a = true ↔ expands g starts a := by
  simp [expandsB, expands]

theorem reachN_sound (g : Graph) (starts : List File) (n : Nat) :
    ∀ x, x ∈ reachN g starts n → Reach g starts x := by
  induction n with
  | zero => intro x hx; exact Reach.start hx
  | succ n ih =>
    intro x hx
    simp only [reachN, round, List.mem_append, List.mem_map, List.mem_filter,
      Bool.and_eq_true] at hx
    cases hx with
    | inl h => exact ih x h
    | inr h =>
      obtain ⟨e, ⟨he, hc, hexp⟩, rfl⟩ := h
      exact Reach.step (ih e.1 (by simpa using hc)) ((expandsB_iff g starts e.1).mp hexp) he

/-- `R` contains the starts and is closed under the walk. -/
def closedB (g : Graph) (starts R : List File) : Bool :=
  starts.all (fun s => R.contains s) &&
    g.edges.all (fun e => !(R.contains e.1 && expandsB g starts e.1) || R.contains e.2)

theorem reach_sub_closed (g : Graph) (starts R : List File) (hc : closedB g starts R = true)
    (x : File) (hx : Reach g starts x) : x ∈ R := by
  simp only [closedB, Bool.and_eq_true, List.all_eq_true] at hc
  induction hx with
  | start hf => simpa using hc.1 _ hf
  | step _ hexp hedge ih =>
    have h := hc.2 _ hedge
    have hexpB := (expandsB_iff g starts _).mpr hexp
    simp [hexpB, ih] at h
    exact h

/-- The certificate: an expected list `R` is exactly the reach of `starts`. -/
def certB (g : Graph) (starts R : List File) : Bool :=
  closedB g starts R && R.all (fun x => (reachList g starts).contains x)

theorem reach_iff_of_cert (g : Graph) (starts R : List File) (h : certB g starts R = true)
    (x : File) : Reach g starts x ↔ x ∈ R := by
  simp only [certB, Bool.and_eq_true, List.all_eq_true] at h
  constructor
  · exact reach_sub_closed g starts R h.1 x
  · intro hx
    have hm : x ∈ reachList g starts := by simpa using h.2 x hx
    exact reachN_sound g starts _ x hm

/-- The exclusive files, computed from certified reach lists: in `RF` and in none of `ROthers`. -/
def exclusiveList (RF : List File) (ROthers : List (List File)) : List File :=
  RF.filter (fun x => ROthers.all (fun R => !R.contains x))

end FeatureMap

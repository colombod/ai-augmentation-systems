/- Generated from ../examples.json by scripts/lib/retire-property.js (toLean). Do not edit:
   change examples.json and regenerate with `node scripts/verify-property.js --write-examples`.
   The same numbers are checked against the real code by scripts/retire-property.test.js. -/
import Model.FeatureMap

namespace FeatureMap.Examples
open FeatureMap

/- A document reached from another file ends the chain; the same document as an anchor is walked. -/
namespace docEndsChain
def g : Graph := { edges := [(0, 1), (1, 2), (0, 3), (3, 4), (4, 5)], docs := [1, 4] }
def anchorsA : List File := [0]
def reachA : List File := [0, 1, 3, 4]
def exclusiveA : List File := [0, 3]
def anchorsB : List File := [1]
def reachB : List File := [1, 2]
def exclusiveB : List File := [2]
def anchorsC : List File := [4]
def reachC : List File := [4, 5]
def exclusiveC : List File := [5]
theorem reachA_cert : certB g anchorsA reachA = true := by decide
theorem reachA_is_model_reach (x : File) : Reach g anchorsA x ↔ x ∈ reachA :=
  reach_iff_of_cert g anchorsA reachA reachA_cert x
theorem exclusiveA_ok : exclusiveList reachA [reachB, reachC] = exclusiveA := by decide
theorem retireA_keepsB : certB (g.remove exclusiveA) (removeFiles exclusiveA anchorsB) reachB = true := by decide
theorem retireA_keepsC : certB (g.remove exclusiveA) (removeFiles exclusiveA anchorsC) reachC = true := by decide
theorem reachB_cert : certB g anchorsB reachB = true := by decide
theorem reachB_is_model_reach (x : File) : Reach g anchorsB x ↔ x ∈ reachB :=
  reach_iff_of_cert g anchorsB reachB reachB_cert x
theorem exclusiveB_ok : exclusiveList reachB [reachA, reachC] = exclusiveB := by decide
theorem retireB_keepsA : certB (g.remove exclusiveB) (removeFiles exclusiveB anchorsA) reachA = true := by decide
theorem retireB_keepsC : certB (g.remove exclusiveB) (removeFiles exclusiveB anchorsC) reachC = true := by decide
theorem reachC_cert : certB g anchorsC reachC = true := by decide
theorem reachC_is_model_reach (x : File) : Reach g anchorsC x ↔ x ∈ reachC :=
  reach_iff_of_cert g anchorsC reachC reachC_cert x
theorem exclusiveC_ok : exclusiveList reachC [reachA, reachB] = exclusiveC := by decide
theorem retireC_keepsA : certB (g.remove exclusiveC) (removeFiles exclusiveC anchorsA) reachA = true := by decide
theorem retireC_keepsB : certB (g.remove exclusiveC) (removeFiles exclusiveC anchorsB) reachB = true := by decide
end docEndsChain

/- Two features share a helper that sits on a cycle; only the entry files are exclusive. -/
namespace sharedHelperWithCycle
def g : Graph := { edges := [(0, 2), (1, 2), (2, 3), (3, 2), (1, 4)], docs := [] }
def anchorsA : List File := [0]
def reachA : List File := [0, 2, 3]
def exclusiveA : List File := [0]
def anchorsB : List File := [1]
def reachB : List File := [1, 2, 3, 4]
def exclusiveB : List File := [1, 4]
theorem reachA_cert : certB g anchorsA reachA = true := by decide
theorem reachA_is_model_reach (x : File) : Reach g anchorsA x ↔ x ∈ reachA :=
  reach_iff_of_cert g anchorsA reachA reachA_cert x
theorem exclusiveA_ok : exclusiveList reachA [reachB] = exclusiveA := by decide
theorem retireA_keepsB : certB (g.remove exclusiveA) (removeFiles exclusiveA anchorsB) reachB = true := by decide
theorem reachB_cert : certB g anchorsB reachB = true := by decide
theorem reachB_is_model_reach (x : File) : Reach g anchorsB x ↔ x ∈ reachB :=
  reach_iff_of_cert g anchorsB reachB reachB_cert x
theorem exclusiveB_ok : exclusiveList reachB [reachA] = exclusiveB := by decide
theorem retireB_keepsA : certB (g.remove exclusiveB) (removeFiles exclusiveB anchorsA) reachA = true := by decide
end sharedHelperWithCycle

/- File 0 is a document: feature A anchors it and walks on to 6, feature C only reaches it and stops, so 6 is exclusive to A. -/
namespace anchorDocAlsoReached
def g : Graph := { edges := [(0, 1), (1, 2), (2, 3), (3, 0), (1, 4), (3, 5), (0, 6)], docs := [0, 2] }
def anchorsA : List File := [0, 2]
def reachA : List File := [0, 1, 2, 3, 4, 5, 6]
def exclusiveA : List File := [6]
def anchorsB : List File := [1]
def reachB : List File := [1, 2, 4]
def exclusiveB : List File := []
def anchorsC : List File := [3]
def reachC : List File := [0, 3, 5]
def exclusiveC : List File := []
theorem reachA_cert : certB g anchorsA reachA = true := by decide
theorem reachA_is_model_reach (x : File) : Reach g anchorsA x ↔ x ∈ reachA :=
  reach_iff_of_cert g anchorsA reachA reachA_cert x
theorem exclusiveA_ok : exclusiveList reachA [reachB, reachC] = exclusiveA := by decide
theorem retireA_keepsB : certB (g.remove exclusiveA) (removeFiles exclusiveA anchorsB) reachB = true := by decide
theorem retireA_keepsC : certB (g.remove exclusiveA) (removeFiles exclusiveA anchorsC) reachC = true := by decide
theorem reachB_cert : certB g anchorsB reachB = true := by decide
theorem reachB_is_model_reach (x : File) : Reach g anchorsB x ↔ x ∈ reachB :=
  reach_iff_of_cert g anchorsB reachB reachB_cert x
theorem exclusiveB_ok : exclusiveList reachB [reachA, reachC] = exclusiveB := by decide
theorem retireB_keepsA : certB (g.remove exclusiveB) (removeFiles exclusiveB anchorsA) reachA = true := by decide
theorem retireB_keepsC : certB (g.remove exclusiveB) (removeFiles exclusiveB anchorsC) reachC = true := by decide
theorem reachC_cert : certB g anchorsC reachC = true := by decide
theorem reachC_is_model_reach (x : File) : Reach g anchorsC x ↔ x ∈ reachC :=
  reach_iff_of_cert g anchorsC reachC reachC_cert x
theorem exclusiveC_ok : exclusiveList reachC [reachA, reachB] = exclusiveC := by decide
theorem retireC_keepsA : certB (g.remove exclusiveC) (removeFiles exclusiveC anchorsA) reachA = true := by decide
theorem retireC_keepsB : certB (g.remove exclusiveC) (removeFiles exclusiveC anchorsB) reachB = true := by decide
end anchorDocAlsoReached

/- No edges: a feature reaches exactly its anchors, and an anchor two features share is not exclusive. -/
namespace sharedAnchorNoEdges
def g : Graph := { edges := [], docs := [] }
def anchorsA : List File := [0, 1]
def reachA : List File := [0, 1]
def exclusiveA : List File := [0]
def anchorsB : List File := [1]
def reachB : List File := [1]
def exclusiveB : List File := []
theorem reachA_cert : certB g anchorsA reachA = true := by decide
theorem reachA_is_model_reach (x : File) : Reach g anchorsA x ↔ x ∈ reachA :=
  reach_iff_of_cert g anchorsA reachA reachA_cert x
theorem exclusiveA_ok : exclusiveList reachA [reachB] = exclusiveA := by decide
theorem retireA_keepsB : certB (g.remove exclusiveA) (removeFiles exclusiveA anchorsB) reachB = true := by decide
theorem reachB_cert : certB g anchorsB reachB = true := by decide
theorem reachB_is_model_reach (x : File) : Reach g anchorsB x ↔ x ∈ reachB :=
  reach_iff_of_cert g anchorsB reachB reachB_cert x
theorem exclusiveB_ok : exclusiveList reachB [reachA] = exclusiveB := by decide
theorem retireB_keepsA : certB (g.remove exclusiveB) (removeFiles exclusiveB anchorsA) reachA = true := by decide
end sharedAnchorNoEdges

#print axioms docEndsChain.reachA_is_model_reach
#print axioms docEndsChain.reachB_is_model_reach
#print axioms docEndsChain.reachC_is_model_reach
#print axioms sharedHelperWithCycle.reachA_is_model_reach
#print axioms sharedHelperWithCycle.reachB_is_model_reach
#print axioms anchorDocAlsoReached.reachA_is_model_reach
#print axioms anchorDocAlsoReached.reachB_is_model_reach
#print axioms anchorDocAlsoReached.reachC_is_model_reach
#print axioms sharedAnchorNoEdges.reachA_is_model_reach
#print axioms sharedAnchorNoEdges.reachB_is_model_reach

end FeatureMap.Examples

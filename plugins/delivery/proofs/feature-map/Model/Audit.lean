/- The audit scripts/verify-property.js reads: what each theorem behind P1 rests on. A proof that
   used `sorry` shows `sorryAx` here, and one that used an axiom beyond Lean's three standard ones
   (propext, Classical.choice, Quot.sound) shows it by name. Either is refused. -/
import Model.FeatureMap

#print axioms FeatureMap.reach_remove_of_disjoint
#print axioms FeatureMap.retire_preserves_reach
#print axioms FeatureMap.reachN_sound
#print axioms FeatureMap.reach_sub_closed
#print axioms FeatureMap.reach_iff_of_cert

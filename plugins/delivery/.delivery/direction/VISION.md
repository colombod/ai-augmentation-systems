# Delivery: vision

Delivery helps a person turn an intent into something customers use, and keep it worth owning. The intent can be an application, a service, a document or a feature. A team of agents does the work. The person decides what only they can decide.

## The outcome

Someone describes what they want. Delivery works out with them what is worth building first, shows the cost of building and of owning it, and proposes a sprint: a short list of deliverables, a bound on time, spend and review rounds, and what is left out. The person approves it, and the team builds exactly that. Each deliverable leaves the product working and gives a customer something they can use. When the deliverables are verified, or a bound is reached, the sprint ends with one report: what was promised, what shipped, what it cost, what was left out, and what needs the person.

A sprint is a closed round. Anything new the person asks for while it runs is kept for the next sprint's proposal, with its value case. Nothing starts mid-round.

Delivery serves the whole life of a product, not only its creation. A product is maintained when it is fixed, simplified and trimmed as well as extended. Retiring a feature that costs more to carry than it returns is delivered value, because it gives resources back.

## The experience

A typical week is quiet. The team works only on a declared sprint and is silent between reports. When the person opens a conversation, the first thing they get is an answer, then what has shipped, what it cost, and any decision waiting. They are never asked to restart a machine or run a command, and they can stop everything with one plain action.

Their attention is a budget, like usage. They set a limit on the decisions and messages a sprint may cost them, and the team reports against it. The Chief of Staff filters what reaches them. The Delivery Manager absorbs the routine conflicts of branches, versions and review rounds so none of those do.

Three things are always true: what is reported as shipped can be used, what is spent is bounded by what the person allowed, and when they say stop, it stops.

## What good looks like

- Useful features win over nice-to-have ones, and the team says which is which.
- Work is ranked by what it enables as well as by what it delivers alone. What exists is reused and extended before anything new is built, so the codebase stays compact and cheap to maintain. Work must earn its place.
- Infrastructure is built only as a strictly necessary step toward a declared deliverable, with the necessity stated before the work starts. The same rule applies to the plugin's own scripts, hooks and tests.
- The team can say which features exist, what code implements them, who uses them and what they cost, and every sprint it proposes what to simplify or retire.
- Doing nothing is a normal and reported state. A team with no declared sprint costs almost nothing.
- Agents decide reversible things themselves and bring the person only what needs their judgment, with evidence and a recommendation.

## What failure looks like

Spending resources without shipping anything a customer can use is the failure that matters most. It is worse than doing nothing, because it also uses up what the person needed for other work. Building and repairing the team's own machinery instead of the product, creating work from its own failures, reporting activity as progress, changing what a round is for while it runs, and continuing without a limit are all forms of it. The first month of this plugin's own team is the example this vision is written against. The [README](README.md) traces each failure to the contract clause that now forbids it.

## How this is organised

This vision is the shared outcome. The contracts that follow each make one promise explicit and say how to check it. A promise is stated once, in one place, and other contracts link to it.

1. [Customer value and increments](contracts/customer-value-and-increments.md)
2. [Intent to increment](contracts/intent-to-increment.md)
3. [Spend and idle](contracts/spend-and-idle.md)
4. [Owner authority and stop](contracts/owner-authority-and-stop.md)
5. [Roles and handoffs](contracts/roles-and-handoffs.md)
6. [Verification and evidence](contracts/verification-and-evidence.md)
7. [Feature map and simplification](contracts/feature-map-and-simplification.md)

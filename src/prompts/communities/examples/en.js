/**
 * English community and global synthesis few-shot examples.
 */

export const COMMUNITIES = [
    {
        label: 'Conspiracy cell (EN/SFW)',
        input: `Entities
- Investigator Renata PERSON  City watch investigator assigned to a missing persons case; reports directly to Lord Bassett
- Lord Councilor Bassett PERSON  Noble who controls the City Watch; architect of the disappearances Renata is investigating
- Mira PERSON  Leader of The Hollows; refugee; holds stolen evidence of Bassett's crimes
- The Hollows ORGANIZATION  Underground network of displaced refugees operating in the city's drainage tunnels
- City Ledger of the Dead OBJECT  Official death record that Bassett has been falsifying for years to erase victims

Relationships
- Renata → Lord Bassett  Reports to him directly; unaware he is the subject of her own investigation
- Renata → The Hollows  Has made contact; treats them as witnesses, not suspects; trust is fragile and untested
- Lord Bassett → The Hollows  Has been ordering raids on their tunnels; directly responsible for the disappearances
- Lord Bassett → City Ledger  Falsified entries for years to erase victims before questions could be asked
- Mira → City Ledger  Stole a copy of original pages before falsification; holds the only surviving proof
- Mira → Renata  Wants to hand over the evidence but hasn't found reason yet to trust a city watch officer`,
        thinking: `1. Entities: Renata(PERSON) + Bassett(PERSON) + Mira(PERSON) + Hollows(ORG) + Ledger(OBJ)
2. Renata -> Bassett: reports, unaware = target; Hollows: fragile contact
3. Bassett -> Hollows: raids; -> Ledger: falsifies; Mira stole originals
4. Mira holds proof, distrusts institutions; Renata trapped inside perpetrator's chain
5. Deadlock: Renata compromised; Mira = only path; Ledger = Bassett's fulcrum
6. 4 findings: info trap, Mira resolution, Bassett vulnerability, Hollows threat`,
        output: `{
  "title": "Bassett Corruption Network",
  "summary": "A corruption structure built on falsified death records, where the investigator assigned to expose it reports directly to the man running it. Lord Bassett has used his control of the City Watch and official documentation to erase victims before anyone can count them. The only intact evidence lives with Mira, leader of the underground refugee network Bassett has been systematically raiding. The dynamic is a deliberate deadlock — Renata has access but is compromised; Mira has the proof but not the trust to deploy it.",
  "findings": [
    "Renata is operating inside the conspiracy without knowing it — every move she makes through official channels is visible to Bassett, which means standard investigative procedure is actively working against her",
    "Mira holds the only surviving original Ledger pages; her distrust of city institutions is entirely earned and is the sole barrier between the evidence and exposure",
    "Bassett's authority is structurally inseparable from official record — the Ledger falsification is not just a crime but the load-bearing wall of his legitimacy, making Mira's stolen pages an existential threat",
    "The Hollows are an organized, off-grid power structure; Bassett keeps raiding them because they cannot be co-opted, which means the raids are suppression rather than cleanup and will continue until someone with authority intervenes"
  ]
}`,
    },
    {
        label: 'Fractured cell (EN/Moderate)',
        input: `Entities
- Dex PERSON  Cell leader; former military; paranoia has escalated since a near-capture six weeks ago
- Solène PERSON  Dex's second-in-command; competent and genuinely loyal; privately doubts his recent judgment
- Priya PERSON  New recruit; exceptional operational instincts with an unexplained prior background
- The Vault PLACE  Primary safehouse; may already be under surveillance
- The Manifesto OBJECT  Document listing all cell members by real name; stored in the Vault

Relationships
- Dex → Solène  Has quietly stopped sharing operational details since Priya arrived; trust eroding without acknowledgment
- Dex → Priya  Keeps her close to observe her, not out of trust; surveillance dressed as mentorship
- Solène → Priya  Genuine connection; has run her training herself; sees real ability and no cause for suspicion
- Solène → Dex  Disagrees with how he's handling Priya but hasn't confronted him; absorbing the friction
- Priya → The Manifesto  Was seen near it twice; Dex noticed and is watching; Solène hasn't
- The Vault → The Manifesto  The document lives here; if the Vault is burned, every name on it is exposed`,
        thinking: `1. Entities: Dex(PERSON) + Solène(PERSON) + Priya(PERSON) + Vault(PLACE) + Manifesto(OBJ)
2. Dex -> Solène: withholding ops; -> Priya: surveillance as mentorship
3. Solène -> Priya: genuine bond + training; Priya near Manifesto twice
4. Dex + Solène = opposite conclusions, no comparison; withholding = accelerant
5. Manifesto exposure unresolved; Vault compromise compounds all risk
6. 5 findings: perception gap, Dex-Solène erosion, Priya ambiguous, Vault liability`,
        output: `{
  "title": "Cell Fracture Point",
  "summary": "A resistance cell fracturing along a perception split rather than any confirmed external threat. Dex's post-capture paranoia has become covert surveillance of his newest recruit, while Solène — his second-in-command — has developed genuine rapport with the same person. Neither is telling the other what they see. The result is a cell where the leader is withholding from his most trusted operator, the new recruit's loyalties are genuinely unresolved, and a document naming every member sits in a safehouse that may already be flagged.",
  "findings": [
    "Dex and Solène are drawing opposite conclusions about Priya and have not compared them — the cell's cohesion depends on a direct conversation neither is initiating",
    "Dex withholding operational details from Solène is the faster-moving fracture; she's the only person positioned to check his judgment, and losing her access to information removes that check entirely",
    "Priya's proximity to the Manifesto twice is either deliberate reconnaissance or coincidence — but Dex noticed without acting, which means he's accumulating evidence in a holding pattern, and that delay has its own compounding cost",
    "The Vault's potential compromise isn't being addressed; every day spent not moving the safehouse is a day the exposure risk for every name on the Manifesto increases",
    "If Priya is clean, Dex's behavior is pushing a capable operator toward the door; if she isn't, Solène's trust has already provided her more access than containment would allow — either outcome is bad"
  ]
}`,
    },
    {
        label: 'Dominant dynamic (EN/Explicit)',
        input: `Entities
- Cass PERSON  Dominant partner; reads Teo's physical responses with precision during scenes; wants emotional access she hasn't been given outside them
- Teo PERSON  Submissive partner; physically present and compliant during sessions; emotionally withdrawn between them
- Vera PERSON  Mutual friend; was sexually involved with Teo before Cass entered the picture; still holds emotional access to him that Cass doesn't have
- Restraint Session CONCEPT  Established ritual between Cass and Teo involving rope work, positional commands, and sustained control
- The Apartment PLACE  Cass's space; all sessions occur here; Teo inhabits it differently inside scenes than outside them

Relationships
- Cass → Teo  Directs scenes with precision; can read his physical state accurately; consistently hits the wall of his emotional withdrawal the moment the session ends
- Teo → Cass  Physically obedient inside sessions; deflects intimacy outside them; endings function like a door closing
- Cass → Vera  Aware of the prior history; hasn't raised it directly; uses Vera as a pressure valve without fully naming what she's actually processing
- Vera → Teo  Occasional contact; emotionally accessible to him in a way that bypasses the withdrawal pattern he runs with Cass
- Teo → Restraint Session  Seeks the sessions himself — he initiates; submission is the one context where he doesn't have to manage his own emotional output
- Vera → Cass  Listens carefully and supports her; observes more than she says`,
        thinking: `1. Entities: Cass(PERSON) + Teo(PERSON) + Vera(PERSON) + Session(CONCEPT) + Apartment(PLACE)
2. Cass -> Teo: directs scenes, precision reads; Teo deflects outside sessions
3. Cass -> Vera: aware of history, pressure valve; Vera -> Teo: emotional access
4. Teo seeks sessions = affect regulation; withdrawal relational != dispositional
5. Power exchange: physical access yes, interior access near-zero
6. 5 findings: affect regulation, relational withdrawal, Vera avoidance, apartment threshold`,
        output: `{
  "title": "Cass and Teo Power Circuit",
  "summary": "A dominant-submissive dynamic that functions with real precision inside sessions and stalls almost completely outside them. Teo seeks the restraint sessions himself — submission is how he regulates affect, the one context where he doesn't have to manage his own emotional output — but consistently withdraws from Cass the moment sessions end. Vera, who knew Teo before Cass, retains an emotional access Cass hasn't been able to build, and Cass is using Vera as a pressure valve while carefully not naming what she's actually trying to understand.",
  "findings": [
    "Teo uses submission as affect regulation rather than purely sexual expression — he initiates because the restraint session is the one space where he doesn't have to perform emotional control, which makes his compliance a form of seeking, not just yielding",
    "The post-session withdrawal is specific to Cass, not a general trait — Vera can reach him when Cass can't, which means the emotional wall is relational rather than dispositional and points to something in what the relationship with Cass represents to him",
    "Cass knows about the Vera history and hasn't named it; her use of Vera as a confidant is partly genuine and partly an avoidance of asking the direct question — what does Vera give Teo that she can't",
    "The apartment functions as a threshold Teo crosses twice in every session — inhabiting it one way inside the scene and a completely different way outside it, a split Cass has noticed and cannot yet address through the dynamic's existing vocabulary",
    "The structural tension in the relationship is that the power exchange gives Cass precise access to Teo's physical and responsive state and almost no access to his interior one — she can read his body and command it; she cannot reach the part of him that's still unavailable"
  ]
}`,
    },
];

export const GLOBAL_SYNTHESIS = [
    {
        label: 'Conspiracy convergence (EN)',
        input: `Communities
- Bassett Corruption Network: Renata investigates disappearances while unknowingly reporting to the man who ordered them. The only surviving evidence is in Mira's hands, held back by her rational distrust of city institutions.
- Hollow Underground: The Hollows are an organized refugee network that Bassett has been systematically raiding. Mira leads them and holds the falsified Ledger pages — the only proof of Bassett's crimes.
- Watch Internal Friction: Two senior Watch officers below Bassett have independently noticed anomalies in the Ledger records. Neither knows the other is looking. Neither has approached Renata.`,
        thinking: `1. Bassett Corruption: Renata trapped inside; Hollows: Mira holds evidence, distrust
2. Watch Friction: two officers, independent, uncoordinated Ledger anomaly inquiry
3. All three -> Bassett from different angles; none in contact
4. Renata + Watch officers -> same Ledger anomalies, don't know each other
5. Race: accidental coordination vs Bassett neutralizing them one-by-one`,
        output: `{
  "global_summary": "A conspiracy beginning to collapse under pressure from three independent directions that haven't located each other yet. Renata investigates from inside the Watch without knowing she reports to her own suspect. Two Watch officers below Bassett are noticing Ledger anomalies in parallel without coordinating. Mira holds the only hard evidence and is waiting for a trust mechanism that hasn't arrived. Bassett's structural vulnerability is the falsified Ledger — a single point of failure that all three threads are approaching from different angles — but his positional advantage is that he sees Renata's moves in real time and can suppress any one investigation before the others converge. The trajectory is a race: accidental coordination among investigators who don't know each other exist versus Bassett identifying and cutting them individually before they find each other."
}`,
    },
    {
        label: 'Operational collapse (EN)',
        input: `Communities
- Cell Fracture Point: Dex's paranoia is consuming the cell's internal coherence. Dex and Solène are assessing Priya from opposite conclusions without comparing notes. The Manifesto lists every member by real name and sits in a safehouse that may already be under surveillance.
- Revolutionary Coordination Network: The upstream network that Dex's cell feeds intelligence to. Leadership is unaware the cell's output has slowed or that the Vault may be flagged.
- The Cartographers: A nominally neutral faction that maps contested territory and sells to multiple buyers. They have recently begun surveying the district where the Vault is located.`,
        thinking: `1. Cell Fracture: internal breakdown, Manifesto exposed, Priya unresolved
2. Coordination Network: upstream uninformed, no visibility into degradation
3. Cartographers: neutral mappers, surveying Vault district, sell to multiple buyers
4. Cartographers = external trigger; maps correlate with Vault if Priya feeds info
5. Cell tears apart while external clock runs; Vault deadline via routine mapping
6. Solène = deciding variable for cell survival; Priya loyalty unresolved`,
        output: `{
  "global_summary": "A cell tearing itself apart from inside while an external clock runs down on it from outside. Dex and Solène's unresolved split over Priya is the internal drag; the Cartographers' routine mapping of the Vault district is the external deadline no one in the cell has identified. The Revolutionary Coordination Network upstream is receiving slowed output without visibility into why and has no mechanism to apply pressure that would force the fracture to resolve. All three communities are converging on the same physical point — the Vault — through unrelated vectors: paranoid watch, potential informant activity, and neutral survey work sold to any buyer. Whether Priya is clean or not, the Vault's exposure window is closing. The Dex-Solène communication failure is the variable that determines whether the cell evacuates in time or gets caught mid-argument about who to trust."
}`,
    },
];

# Real-area acceptance runbook (Mill Creek, Geneva IL)

**Status: NOT executed.** This is a manual check that needs live Overpass access and a human comparing the result to satellite imagery. It has not been run by the implementer; record real results here (or in the commit message) when someone does.

Run `npm run dev` and open the URL.

1. **Draw the boundary.** Zoom to Mill Creek, Geneva IL and draw a polygon around the residential streets (Preston Cir, Branford Ln, Brannon Ln, Grengs Ln, Ellithorp Ln, McNair Dr, S Mill Creek Dr, W Haladay Ln, E Mallory Dr, W/E Burnham Ln and the streets south of them). Keep the polygon **south of Hughes Rd and Fabyan Pkwy**, with the roads themselves outside the polygon. Compare with the reference screenshot `Screenshot From 2026-09-19 15-08-02.png` (kept untracked in the repo root).
2. **Fetch houses.** The status shows the house count. Expected order of magnitude: several hundred.
3. **Verify the count against the satellite.** Pick three streets (Preston Cir, Branford Ln, Grengs Ln), count roofs by eye on the satellite layer and compare with the dots. Target: within about 5%. Fix gaps with **Add house**; remove false positives (garages, sheds, the pool building) with the dot's Remove button.
4. **Review flagged houses.** The panel warns about buildings with no address (orange-outlined dots). Click each and decide whether it is a house; remove those that are not.
5. **Check disconnected warnings.** The panel should not report houses cut off from the street network. If it does (typically across the creek or pond), inspect the snapped street; add the missing footway in OSM or remove the house.
6. **Solve for each plausible group count.** Set Groups to 6, 8 and 10 and click **Solve**. For each check: group sizes within the balance tolerance of the mean (the toolbar's **Balance ±**, 10% of the mean by default and never less than 2 houses, so 78 per group allows 71 to 85), each group's dashed loop covers one solid area rather than interleaving with its neighbours, the panel's "streets split across groups" count is small (on Mill Creek with 6 groups, about 7 of 23 is the practical floor) and the longest loop is not much longer than the others.
7. **Tune.** If the groups look interleaved, raise **Compactness** (toolbar; 2.5 by default, 0 turns it off). If one group walks much further than the others, lower **Balance ±** to even the house counts or edit `weights.maxRoute` upwards. Everything else (`crossingPenalty`, `weights.total`, `secPerHouse`) is edited in the saved project JSON's `config`, loaded again and re-solved. Change one value at a time and note the effect; the panel's per-group "st" figure (street changes around the loop) is the quickest read on whether a route got simpler.
8. **Hand-tune.** Click street segments to move them; confirm live counts, lock the streets you are happy with, then **Re-optimize**.
9. **Print.** Open **Print view**, check the overview and two group pages, then Save as PDF and confirm the pages are legible with numbered stops and address lists.
10. **Save the project** (JSON) so next year starts from it.

## Results

Not recorded (not executed).

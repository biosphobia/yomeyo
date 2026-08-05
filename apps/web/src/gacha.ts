import { levelState } from "./levels.js";
import { formatYennies, levelReward, yennies } from "./yennies.js";

/**
 * The Gacha tab: what yennies are for.
 *
 * The pulls themselves are still to be designed. What is here now is the
 * balance and where it comes from — which is the half that matters for the
 * currency to make sense while the rest is being decided, and the one place
 * besides the end of a run where the number is shown at all.
 */

export async function renderGacha(main: HTMLElement, isCurrent: () => boolean = () => true): Promise<void> {
  const balance = await yennies();
  const level = await levelState();
  if (!isCurrent()) return;

  main.innerHTML = `
    <h1>Gacha</h1>

    <div class="card-panel purse-panel">
      <div class="purse-amount">${formatYennies(balance)}</div>
      <div class="glosses">Yennies</div>
    </div>

    <div class="card-panel">
      <div class="empty-state">
        <div class="big">🎁</div>
        Nothing to pull yet.
        <div class="glosses" style="margin-top:8px">Keep earning; this is being built.</div>
      </div>
    </div>

    <div class="card-panel">
      <b>Where yennies come from</b>
      <div class="purse-source">
        <span>Every right answer</span>
        <span class="purse-rate">1 ¥</span>
      </div>
      <div class="purse-source">
        <span>Reaching level ${level.level + 1}</span>
        <span class="purse-rate">${levelReward(level.level + 1).toLocaleString()} ¥</span>
      </div>
      <div class="msg">
        Each level pays a little more than the last, and costs a lot more XP
        than the last — so the burst is an occasion, not an income.
      </div>
    </div>
  `;
}

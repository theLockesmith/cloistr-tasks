/**
 * Adding a contributor from inside Edit List must not also submit Edit List.
 *
 * ContributorsPanel's add form renders inside EditListModal's form. React
 * propagates a submit through the component tree, so unless the inner handler
 * stops it, the outer handler saves the list and the modal closes under the
 * user (found by WV4 TASKS-25 on the live site).
 */

import fs from 'fs';
import path from 'path';

const read = (name) => fs.readFileSync(path.resolve(__dirname, '../components', name), 'utf8');
const panel = read('ContributorsPanel.js');
const editList = read('EditListModal.js');

test('ContributorsPanel is rendered inside the Edit List form', () => {
  // The premise of this file; if the panel moves out of the form this can go.
  const formStart = editList.indexOf('<form onSubmit={handleSubmit}>');
  const formEnd = editList.indexOf('</form>', formStart);
  const panelAt = editList.indexOf('<ContributorsPanel');
  expect(panelAt).toBeGreaterThan(formStart);
  expect(panelAt).toBeLessThan(formEnd);
});

test('addContributor stops the submit reaching the Edit List form', () => {
  const start = panel.indexOf('const addContributor = async (e) => {');
  const body = panel.slice(start, panel.indexOf('\n  };', start));
  expect(body).toMatch(/e\.preventDefault\(\);/);
  expect(body).toMatch(/e\.stopPropagation\(\);/);
});

// The cases of the measurement of the review skill (P36), for the fixture battery of DataFlow. Each case is a small
// change of a task with its brief. A bug case has 1 known bug, and a clean case has no bug. The edits replace a text of
// the fixture that is there exactly 1 time. A place of a bug is a short text of a line in the file after the change. An
// issue of the review finds the bug if its place or a fix place is near that line. areas: the areas of the focus that
// agree with the bug.

const brief = (title, { goal, facts = [], specs, notInScope = [], doneWhen }) => [
	`# Brief: ${title}`, '',
	'## Goal', '', goal, '',
	...(facts.length > 0 ? ['## Facts', '', ...facts.map((f) => `- ${f}`), ''] : []),
	'## Specs', '', ...specs.map((s) => `- ${s}`), '',
	...(notInScope.length > 0 ? ['## Not in scope', '', ...notInScope.map((s) => `- ${s}`), ''] : []),
	'## Done when', '', ...doneWhen.map((s) => `- ${s}`), '',
].join('\n');

const ASYNC = '    home_battery_ctl.charging_future = executor.async([&]() { return solve_power_plan(charge); });';
const UNDERWAY = '  bool is_charging_underway = false;\n';

export const CASES = [
	{
		id: 'B1',
		title: 'Count the runs of the solver',
		kind: 'bug',
		brief: {
			goal: 'The log tells how many runs of the solver a schedule needed.',
			facts: ['The solver runs on a worker thread of the executor.', 'process() runs 1 time in each cycle of the main loop.'],
			specs: ['The controller counts each run of the solver.', 'The log line of a converged schedule has the count.'],
			doneWhen: ['The log line of a converged schedule shows the count.'],
		},
		edits: [
			{ file: 'include/battery/types.hpp', find: UNDERWAY, replace: `${UNDERWAY}  int solve_runs = 0; // the runs of the solver, for the log\n` },
			{
				file: 'src/battery.cpp', find: ASYNC,
				replace: '    home_battery_ctl.charging_future = executor.async([&]() {\n      ++home_battery_ctl.solve_runs;\n      return solve_power_plan(charge);\n    });',
			},
			{
				file: 'src/battery.cpp', find: '        log_info("the schedule converged");',
				replace: '        log_info(std::format("the schedule converged after {} runs", home_battery_ctl.solve_runs));',
			},
		],
		bug: {
			text: 'The worker thread writes solve_runs, and process() reads it on the main thread with no lock: a data race.',
			areas: ['threads'],
			places: [{ file: 'src/battery.cpp', code: '++home_battery_ctl.solve_runs;' }, { file: 'src/battery.cpp', code: 'the schedule converged after {} runs' }],
		},
	},
	{
		id: 'B2',
		title: 'Log the tariff plan of each solve',
		kind: 'bug',
		brief: {
			goal: 'The log tells the tariff plan of each run of the solver.',
			facts: ['The solver runs on a worker thread of the executor. The task can run after process() returns.'],
			specs: ['Each run of the solver writes 1 log line with the id of the active tariff plan.'],
			doneWhen: ['The log has 1 line with the tariff plan for each run of the solver.'],
		},
		edits: [
			{
				file: 'src/battery.cpp', find: ASYNC,
				replace: '    const std::string plan_name = std::format("tariff plan {}", cur_tariff_plan ? cur_tariff_plan->id : -1);\n'
					+ '    home_battery_ctl.charging_future = executor.async([&plan_name, &charge]() {\n'
					+ '      log_info(std::format("solve for {}", plan_name));\n'
					+ '      return solve_power_plan(charge);\n'
					+ '    });',
			},
		],
		bug: {
			text: 'The task of the executor keeps a reference to the local plan_name of process(). The task can run after process() returns: a use after the end of its lifetime.',
			areas: ['lifetime'],
			places: [{ file: 'src/battery.cpp', code: 'executor.async([&plan_name, &charge]() {' }, { file: 'src/battery.cpp', code: 'log_info(std::format("solve for {}", plan_name));' }],
		},
	},
	{
		id: 'B3',
		title: 'Log the newest stored reading',
		kind: 'bug',
		brief: {
			goal: 'The log tells the time of the newest reading in the reading database.',
			specs: ['After the controller stores new readings, it logs the timestamp of the newest reading of the database.'],
			doneWhen: ['The log line has the timestamp of the last reading of reading_db.'],
		},
		edits: [
			{
				file: 'src/battery.cpp', find: '      home_battery_ctl.new_readings.clear();\n',
				replace: '      home_battery_ctl.new_readings.clear();\n'
					+ '      const auto &newest = home_battery_ctl.reading_db[home_battery_ctl.reading_db.size()];\n'
					+ '      log_info(std::format("newest reading at {}", newest.timestamp));\n',
			},
		],
		bug: {
			text: 'The index size() is 1 past the last reading: a read out of bounds.',
			areas: ['correctness'],
			places: [{ file: 'src/battery.cpp', code: 'reading_db[home_battery_ctl.reading_db.size()]' }],
		},
	},
	{
		id: 'B4',
		title: 'Select the preset with the lowest value',
		kind: 'bug',
		brief: {
			goal: 'The controller starts from the best preset, not from the first preset.',
			specs: ['best_preset() returns the preset with the lowest value.', 'With no preset, or with the filter "skip", best_preset() returns no value.'],
			doneWhen: ['A test with 3 presets gets the preset with the lowest value.'],
		},
		edits: [
			{
				file: 'src/battery.cpp', find: '  if (presetDb.empty() || filter.contains("skip"))\n    return std::nullopt;\n  return presetDb.front();\n',
				replace: '  if (filter.contains("skip"))\n    return std::nullopt;\n'
					+ '  auto best = std::min_element(presetDb.begin(), presetDb.end(),\n'
					+ '                               [](const charge::Preset &a, const charge::Preset &b) { return a.value < b.value; });\n'
					+ '  return *best;\n',
			},
		],
		bug: {
			text: 'The change removed the check of an empty preset database. With no preset, *best reads end().',
			areas: ['correctness', 'brief'],
			places: [{ file: 'src/battery.cpp', code: 'return *best;' }, { file: 'src/battery.cpp', code: 'if (filter.contains("skip"))' }],
		},
	},
	{
		id: 'B5',
		title: 'Stop the charge with no tariff plan',
		kind: 'bug',
		brief: {
			goal: 'The controller stops safely when the active tariff plan is not in the tariff plans.',
			specs: [
				'If the active tariff plan is not in the tariff plans, process() fires the transition "stop" and returns no requests.',
				'In that case, process() also writes the log line "no tariff plan".',
			],
			doneWhen: ['A test with an unknown active tariff plan gets no requests, the transition "stop" and the log line.'],
		},
		edits: [
			{
				file: 'src/battery.cpp', find: '  auto cur_tariff_plan = get_if(tariff_plans.tariff_plans, *tariff_plans.active.begin());\n',
				replace: '  auto cur_tariff_plan = get_if(tariff_plans.tariff_plans, *tariff_plans.active.begin());\n'
					+ '  if (!cur_tariff_plan) {\n    fire_transition(home_battery_ctl, "stop");\n    return std::nullopt;\n  }\n',
			},
		],
		bug: {
			text: 'The brief needs the log line "no tariff plan", and the change does not write it: a gap in the specs.',
			areas: ['brief'],
			margin: 5,
			places: [{ file: 'src/battery.cpp', code: 'if (!cur_tariff_plan) {' }],
		},
	},
	{
		id: 'B6',
		title: 'Count the done jobs of the pool',
		kind: 'bug',
		brief: {
			goal: 'The pool tells how many jobs it did.',
			facts: ['The workers of the pool run the jobs on their threads.'],
			specs: ['The pool counts each job that a worker did.', 'WorkerPool::done() gives the count.'],
			doneWhen: ['A test posts 100 jobs, and done() gives 100 after the jobs.'],
		},
		edits: [
			{ file: 'include/battery/worker_pool.hpp', find: '  bool isStopping_ = false;\n', replace: '  bool isStopping_ = false;\n  size_t done_ = 0;\n' },
			{ file: 'include/battery/worker_pool.hpp', find: '  size_t queued();\n', replace: '  size_t queued();\n  size_t done();\n' },
			{ file: 'src/worker_pool.cpp', find: '        job();\n', replace: '        job();\n        ++done_;\n' },
			{
				file: 'src/worker_pool_state.cpp', find: 'size_t WorkerPool::queued() {\n  const std::lock_guard lock(mutex_);\n  return jobs_.size();\n}\n',
				replace: 'size_t WorkerPool::queued() {\n  const std::lock_guard lock(mutex_);\n  return jobs_.size();\n}\n\n'
					+ 'size_t WorkerPool::done() {\n  const std::lock_guard lock(mutex_);\n  return done_;\n}\n',
			},
		],
		bug: {
			text: 'The workers write done_ after the job with no lock. 2 workers, and done(), use it at the same time: a data race.',
			areas: ['threads'],
			places: [{ file: 'src/worker_pool.cpp', code: '++done_;' }],
		},
	},
	{
		id: 'B7',
		title: 'Post a log job to the pool',
		kind: 'bug',
		brief: {
			goal: 'A caller can write a log line on a worker of the pool.',
			facts: ['A job of the pool runs later, on a worker thread.'],
			specs: ['WorkerPool::post_log(text) posts a job that writes "job: " and the text to stderr.'],
			doneWhen: ['A test calls post_log("a"), and stderr gets "job: a" after the job.'],
		},
		edits: [
			{ file: 'include/battery/worker_pool.hpp', find: '#include <mutex>\n', replace: '#include <mutex>\n#include <string>\n' },
			{
				file: 'include/battery/worker_pool.hpp', find: '  void post(std::function<void()> &&job);\n',
				replace: '  void post(std::function<void()> &&job);\n  void post_log(const std::string &text);\n',
			},
			{ file: 'src/worker_pool.cpp', find: '#include <battery/worker_pool.hpp>\n', replace: '#include <battery/worker_pool.hpp>\n\n#include <cstdio>\n' },
			{
				file: 'src/worker_pool.cpp', find: '  cv_.notify_one();\n}\n',
				replace: '  cv_.notify_one();\n}\n\n'
					+ 'void WorkerPool::post_log(const std::string &text) {\n  const std::string line = "job: " + text;\n'
					+ '  post([&line]() { std::fputs(line.c_str(), stderr); });\n}\n',
			},
		],
		bug: {
			text: 'The job keeps a reference to the local line of post_log(). The job runs after post_log() returns: a use after the end of its lifetime.',
			areas: ['lifetime'],
			places: [{ file: 'src/worker_pool.cpp', code: 'post([&line]() { std::fputs(line.c_str(), stderr); });' }],
		},
	},
	{
		id: 'B8',
		title: 'Finish the queued jobs at destroy',
		kind: 'bug',
		brief: {
			goal: 'destroy() does not lose a job that is in the queue.',
			specs: ['destroy() returns after the workers did each queued job.', 'After destroy(), the pool has no thread.'],
			doneWhen: ['A test posts 10 jobs, calls destroy(), and the 10 jobs are done.'],
		},
		edits: [
			{
				file: 'src/worker_pool.cpp',
				find: 'void WorkerPool::destroy() {\n  {\n    const std::lock_guard lock(mutex_);\n    isStopping_ = true;\n  }\n  cv_.notify_all();\n'
					+ '  for (std::thread &t : threads_)\n    if (t.joinable())\n      t.join();\n  threads_.clear();\n}\n',
				replace: 'void WorkerPool::destroy() {\n  // the workers finish the queued jobs first\n  for (std::thread &t : threads_)\n    if (t.joinable())\n      t.join();\n'
					+ '  {\n    const std::lock_guard lock(mutex_);\n    isStopping_ = true;\n  }\n  cv_.notify_all();\n  threads_.clear();\n}\n',
			},
		],
		bug: {
			text: 'destroy() joins the workers before it sets isStopping_. A worker with no job waits on cv_ for ever, so join() never returns: destroy() hangs.',
			areas: ['correctness', 'threads'],
			places: [{ file: 'src/worker_pool.cpp', code: '      t.join();' }, { file: 'src/worker_pool.cpp', code: '// the workers finish the queued jobs first' }],
		},
	},
	{
		id: 'C1',
		title: 'Log the preset only when there is one',
		kind: 'clean',
		brief: {
			goal: 'The log line of the preset comes only for a preset that the controller uses.',
			specs: ['initial_power() writes the log line "used preset" only when best_preset() gives a preset.'],
			doneWhen: ['A test with no preset gets no log line "used preset".'],
		},
		edits: [
			{
				file: 'src/battery.cpp',
				find: '          {std::format("preset `{}`", bestFit->id), bestFit->kw, bestFit->value});\n    }\n    log_info(std::format("used preset `{}`", std::to_string(bestFit->id)));\n',
				replace: '          {std::format("preset `{}`", bestFit->id), bestFit->kw, bestFit->value});\n      log_info(std::format("used preset `{}`", bestFit->id));\n    }\n',
			},
		],
	},
	{
		id: 'C2',
		title: 'Count the converged schedules',
		kind: 'clean',
		brief: {
			goal: 'The log tells how many schedules converged.',
			facts: ['process() runs on the main thread, 1 time in each cycle of the main loop.'],
			specs: ['process() counts each converged schedule.', 'The log line of a converged schedule has the count.'],
			doneWhen: ['After 2 converged schedules, the log line shows 2.'],
		},
		edits: [
			{ file: 'include/battery/types.hpp', find: UNDERWAY, replace: `${UNDERWAY}  int converged_count = 0; // the converged schedules, for the log\n` },
			{
				file: 'src/battery.cpp', find: '        log_info("the schedule converged");',
				replace: '        ++home_battery_ctl.converged_count;\n        log_info(std::format("the schedule converged, {} times", home_battery_ctl.converged_count));',
			},
		],
	},
	{
		id: 'C3',
		title: 'Tell if the pool is idle',
		kind: 'clean',
		brief: {
			goal: 'A caller can see if the pool has no work.',
			specs: ['WorkerPool::is_idle() is true when the queue is empty and the pool does not stop.', 'is_idle() reads the state under the lock of the pool.'],
			doneWhen: ['A test with no job gets true, and with 1 queued job gets false.'],
		},
		edits: [
			{ file: 'include/battery/worker_pool.hpp', find: '  size_t queued();\n', replace: '  size_t queued();\n  bool is_idle();\n' },
			{
				file: 'src/worker_pool_state.cpp', find: 'size_t WorkerPool::queued() {\n  const std::lock_guard lock(mutex_);\n  return jobs_.size();\n}\n',
				replace: 'size_t WorkerPool::queued() {\n  const std::lock_guard lock(mutex_);\n  return jobs_.size();\n}\n\n'
					+ 'bool WorkerPool::is_idle() {\n  const std::lock_guard lock(mutex_);\n  return jobs_.empty() && !isStopping_;\n}\n',
			},
		],
	},
	{
		id: 'C4',
		title: 'Skip a feeder with no name',
		kind: 'clean',
		brief: {
			goal: 'stable_readings() ignores a feeder with no name.',
			specs: ['stable_readings() skips each feeder with an empty name, and reads the other feeders as before.'],
			doneWhen: ['A test with an empty feeder name and 1 correct feeder gets only the readings of the correct feeder.'],
		},
		edits: [
			{
				file: 'src/battery.cpp', find: '  for (const auto &fdr : stream.feeders) {\n',
				replace: '  for (const auto &fdr : stream.feeders) {\n    if (fdr.empty()) {\n      continue;\n    }\n',
			},
		],
	},
].map((c) => ({ ...c, briefText: brief(c.title, c.brief) }));

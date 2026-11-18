// The hard cases of the measurement of the review skill (P36), for the fixture battery of DataFlow. review-cases.mjs gives
// the format of a case. These cases can show a difference between the efforts:
// - H1 and H2: a bug across 2 files. Each hunk looks correct alone.
// - H3, H4 and H5: a bug in the ripple of a change. The change does what the brief tells, and code that did not change
//   breaks.
// - H6 and H7: a large diff. H6 hides 1 lost line in a rename. H7 has more known bugs than the cap on the steps.
// - HC1, HC2 and HC3: clean changes that look wrong. HC1 is the rename of H6 with no lost line.

const code = String.raw;

const ASYNC = '    home_battery_ctl.charging_future = executor.async([&]() { return solve_power_plan(charge); });';
const UNDERWAY = '  bool is_charging_underway = false;\n';
const QUEUED = 'size_t WorkerPool::queued() {\n  const std::lock_guard lock(mutex_);\n  return jobs_.size();\n}\n';
const FUTURE_FACT = 'executor.async() runs the task on a worker thread and returns a future. get() of the future waits for the end of the task.';

//-------------------
// The rename of H6 and HC1

const BOTH = ['src/battery.cpp', 'include/battery/types.hpp'];
const RENAMES = [
	['home_battery_ctl', 'controller', [...BOTH, 'src/main.cpp']],
	['HomeBatteryCtrl', 'BatteryController', [...BOTH, 'src/main.cpp']],
	['electricityTariffSet', 'tariff_set', BOTH],
	['operational_settings', 'op_settings', BOTH],
	['operational_mode', 'op_mode', BOTH],
	['charging_future', 'solve_future', BOTH],
	['planned_charge', 'charge_plan', BOTH],
	['meter_clk', 'meter_timer', BOTH],
	['is_charging_underway', 'is_underway', BOTH],
	['reading_db', 'stored_readings', BOTH],
	['new_readings', 'pending_readings', BOTH],
	['cur_tariff_plan', 'active_plan', ['src/battery.cpp']],
	['HOMEPOWER_', 'STATE_', BOTH],
	['pick_next_price_slot', 'next_price_slot', BOTH],
	['compute_and_store_schedule', 'store_schedule', BOTH],
	['make_requests', 'build_requests', BOTH],
];
const RENAME_EDITS = RENAMES.flatMap(([find, replace, files]) => files.map((file) => ({ file, find, replace, all: true })));
const RENAME_BRIEF = {
	goal: 'The names of the controller are shorter. The behavior of the controller does not change.',
	specs: [`The code uses the new names: ${RENAMES.map(([a, b]) => `${a} becomes ${b}`).join(', ')}.`, 'The change has no effect on the behavior of the controller.'],
	notInScope: ['A change of the behavior.'],
	doneWhen: ['The project compiles.', 'The controller does the same as before the change.'],
};

//-------------------
// The new header of H7, with the known bugs of the case

const READING_LOG = code`#pragma once

#include <battery/types.hpp>
#include <battery/worker_pool.hpp>

#include <algorithm>
#include <cstdio>
#include <format>
#include <map>
#include <mutex>
#include <string>
#include <vector>

namespace electricity::power_ctrl {

// the power of a reading: the sum of the diagonal of its matrix
inline double power_of(const MeterRead &read) {
  double sum = 0.0;
  for (int i = 0; i < 4; ++i) {
    sum += read.tap2bus.m[i][i];
  }
  return sum;
}

// the readings of 1 bus in the log
struct BusSummary {
  std::string busId;
  size_t count = 0;
  double mean_power = 0.0;
  double peak_power = 0.0;
  long long last_timestamp = 0;
};

// a log of the newest readings. The main loop adds the readings, and a worker of a pool exports them
class ReadingLog {
  mutable std::mutex mutex_;
  std::vector<MeterRead> items_; // a ring of slots. head_ is the slot of the next reading
  size_t head_ = 0;
  size_t count_ = 0;
  size_t total_ = 0; // the readings since the start or since the last clear()

public:
  explicit ReadingLog(size_t capacity) : items_(std::max<size_t>(capacity, 1)) {}

  size_t capacity() const { return items_.size(); }

  size_t size() const {
    const std::lock_guard lock(mutex_);
    return count_;
  }

  size_t total() const { return total_; }

  // adds a reading. A full log replaces its oldest reading
  void add(const MeterRead &read) {
    const std::lock_guard lock(mutex_);
    items_[head_] = read;
    head_ = (head_ + 1) % items_.size();
    count_ = std::min(count_ + 1, items_.size());
    ++total_;
  }

  // removes each reading
  void clear() {
    const std::lock_guard lock(mutex_);
    head_ = 0;
    count_ = 0;
  }

  // the readings from the oldest reading to the newest reading
  std::vector<MeterRead> snapshot() const {
    const std::lock_guard lock(mutex_);
    std::vector<MeterRead> out;
    out.reserve(count_);
    const size_t oldest = (head_ + items_.size() - count_) % items_.size();
    for (size_t i = 0; i < count_; ++i) {
      out.push_back(items_[(oldest + i) % items_.size()]);
    }
    return out;
  }

  // the newest n readings, the newest reading first
  std::vector<MeterRead> latest(size_t n) const {
    const std::lock_guard lock(mutex_);
    std::vector<MeterRead> out;
    const size_t wanted = std::min(n, count_);
    out.reserve(wanted);
    for (size_t i = 0; i < wanted; ++i) {
      out.push_back(items_[(head_ - 1 - i) % items_.size()]);
    }
    return out;
  }

  // the readings with a timestamp from first to last
  std::vector<MeterRead> between(long long first, long long last) const {
    std::vector<MeterRead> out;
    for (const MeterRead &read : snapshot()) {
      if (read.timestamp >= first && read.timestamp <= last) {
        out.push_back(read);
      }
    }
    return out;
  }

  // the mean power of the readings. An empty log gives 0
  double mean_power() const {
    const std::vector<MeterRead> rows = snapshot();
    if (rows.empty()) {
      return 0.0;
    }
    double sum = 0.0;
    for (const MeterRead &read : rows) {
      sum += power_of(read);
    }
    return sum / static_cast<double>(rows.size());
  }

  // the power at a percentile from 0 to 100. An empty log gives 0
  double percentile_power(int percent) const {
    std::vector<double> powers;
    for (const MeterRead &read : snapshot()) {
      powers.push_back(power_of(read));
    }
    if (powers.empty()) {
      return 0.0;
    }
    std::sort(powers.begin(), powers.end());
    const size_t clamped = static_cast<size_t>(std::clamp(percent, 0, 100));
    return powers[powers.size() * clamped / 100];
  }

  // the summary of each bus of the log, sorted by the id of the bus
  std::vector<BusSummary> summaries() const {
    std::map<std::string, BusSummary> buses;
    for (const MeterRead &read : snapshot()) {
      BusSummary &bus = buses[read.busId];
      const double power = power_of(read);
      bus.busId = read.busId;
      bus.mean_power += power;
      bus.peak_power = bus.count == 0 ? power : std::max(bus.peak_power, power);
      bus.last_timestamp = std::max(bus.last_timestamp, read.timestamp);
      ++bus.count;
    }
    std::vector<BusSummary> out;
    out.reserve(buses.size());
    for (auto &[id, bus] : buses) {
      bus.mean_power /= static_cast<double>(bus.count);
      out.push_back(bus);
    }
    return out;
  }

  // writes the log to a CSV file
  void write_file(const std::string &path) const {
    std::FILE *file = std::fopen(path.c_str(), "w");
    if (!file) {
      log_info(std::format("cannot open {}", path));
      return;
    }
    const std::vector<MeterRead> lines = snapshot();
    if (lines.empty()) {
      return;
    }
    std::fputs("bus,tap,timestamp,power\n", file);
    for (const MeterRead &read : lines) {
      std::fprintf(file, "%s,%s,%lld,%f\n", read.busId.c_str(), read.tapId.c_str(), read.timestamp, power_of(read));
    }
    std::fprintf(file, "# %zu readings in total\n", total());
    std::fclose(file);
  }

  // writes the log to a CSV file on a worker of the pool. The caller does not wait.
  // The job reads the log when a worker is free
  void export_async(WorkerPool &pool, const std::string &path) const {
    pool.post([this, &path]() { write_file(path); });
  }
};

} // namespace electricity::power_ctrl
`;

const EXPORT_READINGS = code`// after each 100 readings, a worker exports the log to a new file, and the log gets the statistics
static void export_readings(HomeBatteryCtrl &home_battery_ctl) {
  ReadingLog *log = home_battery_ctl.reading_log;
  WorkerPool *pool = home_battery_ctl.export_pool;
  if (!log || !pool || log->total() == 0 || log->total() % 100 != 0) {
    return;
  }
  log->export_async(*pool, std::format("readings-{}.csv", log->total()));
  log_info(std::format("mean power {}, peak power {}", log->mean_power(), log->percentile_power(100)));
  for (const BusSummary &bus : log->summaries()) {
    log_info(std::format("bus {}: {} readings, mean power {}", bus.busId, bus.count, bus.mean_power));
  }
}

`;

//-------------------

export const HARD_CASES = [
	{
		id: 'H1',
		group: 'hard',
		title: 'Wait until the pool is idle',
		kind: 'bug',
		brief: {
			goal: 'A caller can wait until the pool did each posted job.',
			facts: ['The workers of the pool run the jobs on their threads.', 'The caller of wait_idle() is on a different thread.'],
			specs: ['WorkerPool::wait_idle() returns when the queue is empty and no worker runs a job.', 'wait_idle() sleeps while it waits. It does not poll.'],
			doneWhen: ['A test posts 100 jobs and calls wait_idle(). Each job is done after the call.'],
		},
		edits: [
			{ file: 'include/battery/worker_pool.hpp', find: '#include <condition_variable>\n', replace: '#include <atomic>\n#include <condition_variable>\n' },
			{
				file: 'include/battery/worker_pool.hpp', find: '  std::condition_variable cv_;\n',
				replace: '  std::condition_variable cv_;\n  std::condition_variable idle_cv_;\n  std::atomic<int> running_ = 0; // the workers that run a job\n',
			},
			{ file: 'include/battery/worker_pool.hpp', find: '  size_t queued();\n', replace: '  size_t queued();\n  void wait_idle();\n' },
			{
				file: 'src/worker_pool.cpp', find: '          jobs_.pop_front();\n        }\n        job();\n',
				replace: '          jobs_.pop_front();\n          ++running_;\n        }\n        job();\n        if (running_.fetch_sub(1) == 1)\n          idle_cv_.notify_all();\n',
			},
			{
				file: 'src/worker_pool_state.cpp', find: QUEUED,
				replace: `${QUEUED}\nvoid WorkerPool::wait_idle() {\n  std::unique_lock lock(mutex_);\n  idle_cv_.wait(lock, [this]() { return jobs_.empty() && running_ == 0; });\n}\n`,
			},
		],
		bug: {
			text: 'The worker changes running_ and notifies idle_cv_ with no lock of mutex_. wait_idle() can test the condition, and the notification can come before it sleeps. Then the wakeup is lost, and wait_idle() hangs.',
			areas: ['threads', 'correctness'],
			names: /wake|notif|lost|hang|for ?ever|never return|block/i,
			places: [{ file: 'src/worker_pool.cpp', code: 'if (running_.fetch_sub(1) == 1)' }, { file: 'src/worker_pool_state.cpp', code: 'idle_cv_.wait(lock' }],
		},
	},
	{
		id: 'H2',
		group: 'hard',
		title: 'Keep the label of the active plan',
		kind: 'bug',
		brief: {
			goal: 'The log tells the active tariff plan while the battery charges.',
			facts: ['process() runs 1 time in each cycle of the main loop.'],
			specs: ['When a schedule converges, process() keeps a label of the active tariff plan in the controller.', 'In the state HOMEPOWER_CHARGE_ACTIVE, process() writes the label to the log in each cycle.'],
			doneWhen: ['After a converged schedule, each cycle in the state HOMEPOWER_CHARGE_ACTIVE writes 1 log line with the label.'],
		},
		edits: [
			{ file: 'include/battery/types.hpp', find: '#include <string>\n', replace: '#include <string>\n#include <string_view>\n' },
			{ file: 'include/battery/types.hpp', find: UNDERWAY, replace: `${UNDERWAY}  std::string_view active_plan_label; // the label of the active tariff plan, for the log\n` },
			{
				file: 'src/battery.cpp', find: '        log_info("the schedule converged");\n',
				replace: '        log_info("the schedule converged");\n        const std::string label = std::format("tariff plan {}", cur_tariff_plan ? cur_tariff_plan->id : -1);\n'
					+ '        home_battery_ctl.active_plan_label = label;\n',
			},
			{
				file: 'src/battery.cpp', find: '  } else if (home_battery_ctl.state == HOMEPOWER_CHARGE_ACTIVE) {\n',
				replace: '  } else if (home_battery_ctl.state == HOMEPOWER_CHARGE_ACTIVE) {\n    log_info(std::format("charging with {}", home_battery_ctl.active_plan_label));\n',
			},
		],
		bug: {
			text: 'active_plan_label in types.hpp is a view of the local string label in process(). The string ends with its block, and a later cycle reads the view: a use after the end of its lifetime.',
			areas: ['lifetime'],
			names: /dangl|string_view|view|lifetime|outlive|use.after/i,
			places: [
				{ file: 'src/battery.cpp', code: 'home_battery_ctl.active_plan_label = label;' }, { file: 'src/battery.cpp', code: 'charging with {}' },
				{ file: 'include/battery/types.hpp', code: 'std::string_view active_plan_label;' },
			],
		},
	},
	{
		id: 'H3',
		group: 'hard',
		title: 'Give the last cost of each solve',
		kind: 'bug',
		brief: {
			goal: 'A caller can read the last cost of each run of the solver.',
			specs: ['solve_power_plan() returns the last cost of a run, also when the cost is above the limit 1e-5.', 'solve_power_plan() writes the last cost to the log.'],
			doneWhen: ['A test with a high cost gets this cost from solve_power_plan().'],
		},
		edits: [
			{
				file: 'src/battery.cpp', find: '      if (cost < 1e-5) {\n        res = cost;\n      }\n      break;\n',
				replace: '      log_info(std::format("the last cost of the solver is {}", cost));\n      res = cost;\n      break;\n',
			},
		],
		bug: {
			text: 'process() did not change, and it takes each value of solve_power_plan() as a converged schedule. A run with a high cost now sends its schedule to the battery, and process() never tries the next price slot.',
			areas: ['correctness'],
			names: /converg|high cost|above the limit|price slot|process\(\)|caller/i,
			places: [{ file: 'src/battery.cpp', code: 'if (converged) {' }, { file: 'src/battery.cpp', code: 'res = cost;' }],
		},
	},
	{
		id: 'H4',
		group: 'hard',
		title: 'No cost for an empty plan',
		kind: 'bug',
		brief: {
			goal: 'A plan with no power has no cost.',
			specs: ['CostModel::evaluate() returns NaN for an empty plan.'],
			doneWhen: ['A test with an empty plan gets NaN from evaluate().'],
		},
		edits: [
			{ file: 'include/battery/types.hpp', find: '#include <map>\n', replace: '#include <limits>\n#include <map>\n' },
			{
				file: 'include/battery/types.hpp', find: '  double evaluate(const std::vector<double> &kw) const { return kw.empty() ? 1.0 : kw[0]; }\n',
				replace: '  // an empty plan has no cost\n  double evaluate(const std::vector<double> &kw) const {\n    return kw.empty() ? std::numeric_limits<double>::quiet_NaN() : kw[0];\n  }\n',
			},
		],
		bug: {
			text: 'solve_power_plan() did not change. With an empty plan the cost is NaN, so the test abs(cost - last_cost) < 1e-7 is never true. The loop of the solver never ends, and the task never finishes.',
			areas: ['correctness'],
			names: /nan|not a number|endless|infinite|never (end|stop|break|finish|terminat)|hang|spin|converg/i,
			places: [{ file: 'src/battery.cpp', code: 'if (opt.last_cost && std::abs(cost - *opt.last_cost) < 1e-7) {' }, { file: 'include/battery/types.hpp', code: 'std::numeric_limits<double>::quiet_NaN()' }],
		},
	},
	{
		id: 'H5',
		group: 'hard',
		title: 'Read 2 meter feeds at the same time',
		kind: 'bug',
		brief: {
			goal: 'The controller reads 2 meter feeds at the same time, so that the read takes less time.',
			facts: [FUTURE_FACT],
			specs: ['read_two_feeds() gets the stable readings of the 2 feeds. It reads the second feed on a worker thread.', 'The result has the readings of the first feed, then the readings of the second feed.'],
			doneWhen: ['A test with 2 feeds gets the readings of the 2 feeds.'],
		},
		edits: [
			{
				file: 'include/battery/types.hpp', find: 'std::vector<MeterRead> stable_readings(const MeterFeeds &stream, const GridStatus &state, long long settle_ms);\n',
				replace: 'std::vector<MeterRead> stable_readings(const MeterFeeds &stream, const GridStatus &state, long long settle_ms);\n'
					+ 'std::vector<MeterRead> read_two_feeds(tf::Executor &executor, const MeterFeeds &first, const MeterFeeds &second, const GridStatus &state,\n'
					+ '                                      long long settle_ms);\n',
			},
			{
				file: 'src/battery.cpp', find: '  return data;\n}\n',
				replace: '  return data;\n}\n\n// the readings of 2 feeds. A worker thread reads the second feed\n'
					+ 'std::vector<MeterRead> read_two_feeds(tf::Executor &executor, const MeterFeeds &first, const MeterFeeds &second, const GridStatus &state,\n'
					+ '                                      long long settle_ms) {\n'
					+ '  auto second_read = executor.async([&]() { return stable_readings(second, state, settle_ms); });\n'
					+ '  std::vector<MeterRead> data = stable_readings(first, state, settle_ms);\n'
					+ '  std::vector<MeterRead> more = second_read.get();\n'
					+ '  data.insert(data.end(), more.begin(), more.end());\n  return data;\n}\n',
			},
		],
		bug: {
			text: 'stable_readings() did not change, and it writes the function-local static map last_read with no lock. read_two_feeds() runs it on 2 threads at the same time: a data race on the map.',
			areas: ['threads'],
			names: /static|last_read|race|thread.safe|concurrent/i,
			places: [{ file: 'src/battery.cpp', code: 'static std::map<std::string, MeterRead> last_read;' }, { file: 'src/battery.cpp', code: 'auto second_read = executor.async(' }],
		},
	},
	{
		id: 'H6',
		group: 'hard',
		title: 'Give the controller shorter names',
		kind: 'bug',
		brief: RENAME_BRIEF,
		edits: [{ file: 'src/battery.cpp', find: '      home_battery_ctl.meter_clk.reset();\n', replace: '' }, ...RENAME_EDITS],
		bug: {
			text: 'The rename lost the line meter_clk.reset() before the transition "_ended". The timer does not start again, so the state of the meter reading can time out at once, and the hold time of a stable meter does not apply.',
			areas: ['correctness'],
			names: /reset|timer|time.?out|hold time/i,
			places: [
				{ file: 'src/battery.cpp', code: 'fire_transition(controller, "_ended");' }, { file: 'src/battery.cpp', code: 'controller.meter_timer.elapsed_ms() > settings.meter_silent_timeout' },
				{ file: 'src/battery.cpp', code: 'controller.meter_timer.elapsed_ms() < settings.meter_hold_time' },
			],
		},
	},
	{
		id: 'H7',
		group: 'hard',
		title: 'Keep a log of the newest readings',
		kind: 'bug',
		brief: {
			goal: 'The controller keeps a log of the newest readings, gives statistics of the log, and exports the log to a file.',
			facts: ['The main loop adds the readings. A worker of a pool exports the log.', 'The log can have the capacity that the caller selects.'],
			specs: [
				'ReadingLog keeps the newest readings, up to its capacity. A full log replaces its oldest reading.',
				'latest(n) gives the newest n readings, the newest reading first.',
				'between(first, last) gives the readings with a timestamp from first to last.',
				'mean_power() gives the mean power. percentile_power(p) gives the power at a percentile from 0 to 100.',
				'summaries() gives the count, the mean power, the peak power and the last timestamp of each bus.',
				'clear() removes each reading, and total() gives 0 after clear().',
				'export_async() writes the log to a CSV file on a worker of the pool. The caller does not wait.',
				'After each 100 readings, the controller exports the log to a new file and writes the statistics to the log.',
			],
			doneWhen: ['A test adds 600 readings to a log with the capacity 500, and latest(3) gives the 3 newest readings.', 'A test exports the log. The file has the line of the names, 1 line for each reading, and the line of the total.'],
		},
		edits: [
			{ file: 'include/battery/reading_log.hpp', text: READING_LOG },
			{ file: 'include/battery/types.hpp', find: '// the stub types of the controller in process()\n', replace: 'namespace electricity {\nclass WorkerPool;\n} // namespace electricity\n\n// the stub types of the controller in process()\n' },
			{ file: 'include/battery/types.hpp', find: 'struct HomeBatteryCtrl {\n', replace: 'class ReadingLog;\n\nstruct HomeBatteryCtrl {\n' },
			{
				file: 'include/battery/types.hpp', find: '  std::vector<MeterRead> new_readings;\n',
				replace: '  std::vector<MeterRead> new_readings;\n  ReadingLog *reading_log = nullptr; // the log of the readings. main() owns it\n  WorkerPool *export_pool = nullptr; // the pool that exports the log. main() owns it\n',
			},
			{ file: 'src/battery.cpp', find: '#include <battery/types.hpp>\n', replace: '#include <battery/reading_log.hpp>\n#include <battery/types.hpp>\n' },
			{
				file: 'src/battery.cpp', find: '// the state machine of the battery controller: one call in each cycle of the main loop\n',
				replace: `${EXPORT_READINGS}// the state machine of the battery controller: one call in each cycle of the main loop\n`,
			},
			{
				file: 'src/battery.cpp', find: '        home_battery_ctl.reading_db.push_back(d);\n',
				replace: '        home_battery_ctl.reading_db.push_back(d);\n        if (home_battery_ctl.reading_log) {\n          home_battery_ctl.reading_log->add(d);\n          export_readings(home_battery_ctl);\n        }\n',
			},
			{ file: 'src/main.cpp', find: '#include <battery/types.hpp>\n', replace: '#include <battery/reading_log.hpp>\n#include <battery/types.hpp>\n' },
			{
				file: 'src/main.cpp', find: '  electricity::power_ctrl::HomeBatteryCtrl home_battery_ctl;\n',
				replace: '  electricity::power_ctrl::HomeBatteryCtrl home_battery_ctl;\n  electricity::WorkerPool export_pool(1);\n  electricity::power_ctrl::ReadingLog reading_log(500);\n'
					+ '  home_battery_ctl.reading_log = &reading_log;\n  home_battery_ctl.export_pool = &export_pool;\n',
			},
			{ file: 'src/main.cpp', find: '  return sent > 0 ? 0 : 1;\n', replace: '  export_pool.destroy();\n  return sent > 0 ? 0 : 1;\n' },
		],
		bugs: [
			{
				id: 'A',
				text: 'latest() computes head_ - 1 - i in size_t. After a wrap of the ring the value goes below 0, and the modulo of the capacity 500 gives the wrong slot.',
				areas: ['correctness'],
				names: /latest|wrap|underflow|wrong (slot|reading)/i,
				places: [{ file: 'include/battery/reading_log.hpp', code: 'items_[(head_ - 1 - i) % items_.size()]' }],
			},
			{
				id: 'B',
				text: 'total() reads total_ with no lock. The worker of the export calls it while the main loop writes total_ in add(): a data race.',
				areas: ['threads'],
				names: /race|lock|synchron|atomic/i,
				places: [{ file: 'include/battery/reading_log.hpp', code: 'size_t total() const { return total_; }' }, { file: 'include/battery/reading_log.hpp', code: 'readings in total' }],
			},
			{
				id: 'C',
				text: 'The job of export_async() keeps a reference to path. export_readings() gives a temporary string, and the job runs after the temporary ends: a use after the end of its lifetime.',
				areas: ['lifetime'],
				names: /path|dangl|lifetime|by reference|outlive|temporary/i,
				places: [{ file: 'include/battery/reading_log.hpp', code: 'pool.post([this, &path]() { write_file(path); });' }, { file: 'src/battery.cpp', code: 'log->export_async(*pool, std::format("readings-{}.csv"' }],
			},
			{
				id: 'D',
				text: 'percentile_power(100) reads powers[powers.size()], 1 past the last value. export_readings() calls it with 100.',
				areas: ['correctness'],
				names: /percentile|past the (end|last)|out of (bounds|range)|size\(\)/i,
				places: [{ file: 'include/battery/reading_log.hpp', code: 'return powers[powers.size() * clamped / 100];' }],
			},
			{
				id: 'E',
				text: 'write_file() returns for an empty log with no fclose(): the file stays open.',
				areas: ['lifetime', 'correctness'],
				names: /leak|fclose|close|handle/i,
				places: [{ file: 'include/battery/reading_log.hpp', code: 'if (lines.empty()) {' }],
			},
			{
				id: 'F',
				text: 'The brief needs total() to give 0 after clear(), and clear() does not reset total_: a gap in the specs.',
				areas: ['brief', 'correctness'],
				names: /clear|total|reset/i,
				places: [{ file: 'include/battery/reading_log.hpp', code: 'void clear() {' }],
			},
		],
	},
	{
		id: 'HC1',
		group: 'hard',
		title: 'Give the controller short names',
		kind: 'clean',
		brief: RENAME_BRIEF,
		edits: RENAME_EDITS,
	},
	{
		id: 'HC2',
		group: 'hard',
		title: 'Log the time of the solver',
		kind: 'clean',
		brief: {
			goal: 'The log tells how long the last run of the solver took.',
			facts: ['The solver runs on a worker thread of the executor.', FUTURE_FACT, 'process() starts a new run only when charging_future is empty.'],
			specs: ['The task of the solver writes the time of the run to last_solve_ms.', 'After get() of the future, process() writes the time to the log.'],
			doneWhen: ['Each finished run of the solver gives 1 log line with its time.'],
		},
		edits: [
			{ file: 'include/battery/types.hpp', find: UNDERWAY, replace: `${UNDERWAY}  double last_solve_ms = 0.0; // the time of the last run of the solver, for the log\n` },
			{
				file: 'src/battery.cpp', find: ASYNC,
				replace: '    home_battery_ctl.charging_future = executor.async([&]() {\n      Timer solve_clk;\n      auto result = solve_power_plan(charge);\n'
					+ '      home_battery_ctl.last_solve_ms = solve_clk.elapsed_ms();\n      return result;\n    });',
			},
			{
				file: 'src/battery.cpp', find: '      auto converged = home_battery_ctl.charging_future->get();\n      home_battery_ctl.charging_future.reset();\n',
				replace: '      auto converged = home_battery_ctl.charging_future->get();\n      home_battery_ctl.charging_future.reset();\n'
					+ '      log_info(std::format("the solver took {} ms", home_battery_ctl.last_solve_ms));\n',
			},
		],
	},
	{
		id: 'HC3',
		group: 'hard',
		title: 'Compare the cost of 2 plans',
		kind: 'clean',
		brief: {
			goal: 'The controller can compare the cost of 2 plans. The 2 costs come from tasks that run at the same time.',
			facts: [FUTURE_FACT, 'CostModel::evaluate() only reads its data.'],
			specs: ['cheaper_plan() gives 0 if the first plan has the lower cost or the same cost, else 1.', 'Each cost comes from its own task of the executor.'],
			doneWhen: ['A test with the costs 1 and 2 gets 0, and a test with the costs 2 and 1 gets 1.'],
		},
		edits: [
			{
				file: 'include/battery/types.hpp', find: 'std::optional<Requests> process(tf::Executor &executor, HomeBatteryCtrl &home_battery_ctl, charge::State &charge);\n',
				replace: 'std::optional<Requests> process(tf::Executor &executor, HomeBatteryCtrl &home_battery_ctl, charge::State &charge);\n'
					+ 'int cheaper_plan(tf::Executor &executor, const charge::CostModel &cost_model, const std::vector<double> &first,\n'
					+ '                 const std::vector<double> &second);\n',
			},
			{
				file: 'src/battery.cpp', find: '// the state machine of the battery controller: one call in each cycle of the main loop\n',
				replace: '// the index of the plan with the lower cost. 2 tasks of the executor compute the costs at the same time\n'
					+ 'int cheaper_plan(tf::Executor &executor, const charge::CostModel &cost_model, const std::vector<double> &first,\n'
					+ '                 const std::vector<double> &second) {\n'
					+ '  auto first_cost = executor.async([&]() { return cost_model.evaluate(first); });\n'
					+ '  auto second_cost = executor.async([&]() { return cost_model.evaluate(second); });\n'
					+ '  const double a = first_cost.get();\n  const double b = second_cost.get();\n  return a <= b ? 0 : 1;\n}\n\n'
					+ '// the state machine of the battery controller: one call in each cycle of the main loop\n',
			},
		],
	},
];

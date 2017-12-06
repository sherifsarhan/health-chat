var schedule = require('./schedule');

class Helpers {
    constructor(builder) {
        this.builder = builder;
    }
    cleanDateRange(dateRange) {
        let dateRangeClean = []
        // check if there is more than one date RANGE
        // make sure the ranges are clean. Ex. cannot be a range in the past
        if (dateRange.length > 1) {
            // there is
            // if the start of the range is not before today, add it to array
            dateRange.forEach((date) => {
                let tempDateObj = date.start ? new Date(date.start) : new Date(date.value);
                let tempDate = tempDateObj.getUTCDate();
                let tempMonth = tempDateObj.getUTCMonth();

                let currDateObj = new Date();
                let currDate = currDateObj.getUTCDate();
                let currMonth = currDateObj.getUTCMonth();
                // if the date is today or onwards
                if ((tempMonth > currMonth) || (tempMonth = currMonth && tempDate >= currDate)) {
                    // add it to acceptable date range
                    dateRangeClean.push(date);
                }
            });
        }
        if (dateRange.length == 1) dateRangeClean.push(dateRange[0]);
        return dateRangeClean;
    }

    handleDateTimeRange(session, dateRangeClean) {
        // may have 0 date ranges after cleaning
        // ask time and tell them the date can't be in the past
        if (!dateRangeClean.length) {
            // then open dialog asking for day/time
            session.beginDialog('askDayAndTime', { pastDate: true });
        }

        // may have 1 date range after cleaning 
        if (dateRangeClean.length == 1) {
            // check for available timeslots that fall in between start/end in given day
            session.userData.requestedDate = new Date(dateRangeClean[0].start);
            session.userData.availableTimeslots = this.getAvailableTimeslots(session, new Date(dateRangeClean[0].end));

            // if no available timeslots
            // try to find another day/time that works
            let isTimeslotAvailable = session.userData.availableTimeslots.length > 0;
            if (isTimeslotAvailable) {
                session.beginDialog('askTimeForGivenDay', { avail: isTimeslotAvailable });
            }
            else {
                session.beginDialog('askTimeForGivenDay', { unavail: !isTimeslotAvailable });
            }
        }
        // TODO: may have >1 date ranges after cleaning
    }

    getDates(startDate, stopDate) {
        // returns array of dates in between two dates
        var dateArray = new Array();
        var currentDate = startDate;
        while (currentDate <= stopDate) {
            dateArray.push(new Date(currentDate));
            currentDate = currentDate.addDays(1);
        }
        return dateArray;
    }

    handleDateRange(session, dateRangeClean, timeRange, singleDate) {
        // singleDate param is optional. A single date can be passed in and timeslots will be found for it

        // get array of dates we need timeslots for day(s)
        let dates;
        if (!singleDate) {
            let startDate = new Date(dateRangeClean[0].start);
            let todayDate = new Date();
            dates = this.getDates(startDate < todayDate ? todayDate : startDate, new Date(dateRangeClean[0].end));
        }
        else dates = [new Date(singleDate)];

        let allTimeslots = []
        // for each date, get available timeslots and add it to total timeslots list
        dates.forEach((date) => {
            let endTime;
            if (timeRange) {
                let startTime = this.builder.EntityRecognizer.parseTime(timeRange.start);
                endTime = this.builder.EntityRecognizer.parseTime(timeRange.end);
                date.setUTCHours(startTime.getUTCHours());
                date.setUTCMinutes(startTime.getUTCMinutes());
            }
            session.userData.requestedDate = date;
            let timeslots = this.getAvailableTimeslots(session, endTime);
            allTimeslots = allTimeslots.concat(timeslots);
        });
        session.userData.availableTimeslots = allTimeslots;
        session.beginDialog('askTimeForGivenDay', { avail: true, dateRange: true });
    }

    isTimeslotAvailable(session, requestedDate) {
        let apptDatePath = schedule.doctorsSchedule[session.userData.doctorType][requestedDate.getFullYear()][requestedDate.getUTCMonth()]
        [requestedDate.getUTCDate()][requestedDate.getHours()];
        if (apptDatePath && apptDatePath[requestedDate.getMinutes()] == 'available') {
            return true;
        }
        return false;
    }

    bookTimeslot(session, requestedDate) {
        let apptDatePath = schedule.doctorsSchedule[session.userData.doctorType][requestedDate.getFullYear()][requestedDate.getUTCMonth()]
        [requestedDate.getUTCDate()][requestedDate.getHours()];
        if (apptDatePath[requestedDate.getMinutes()] == 'available') {
            apptDatePath[requestedDate.getMinutes()] = 'booked';
            return true;
        }
        return false;
    }

    getAvailableTimeslots(session, endTime) {
        let requestedDate = (session.userData.requestedDate instanceof Date) ? session.userData.requestedDate : new Date(session.userData.requestedDate);
        let apptHours = schedule.doctorsSchedule[session.userData.doctorType][requestedDate.getFullYear()][requestedDate.getUTCMonth()]
        [requestedDate.getUTCDate()];
        let availableTimes = [];
        for (var hour in apptHours) {
            if (apptHours.hasOwnProperty(hour)) {
                var minutes = apptHours[hour];
                for (var minute in minutes) {
                    if (apptHours[hour][minute] == 'available') {
                        // looks messy but is simple
                        // 2 conditions for the timeslot to be added even though the timeslot is available
                        // 1: need to check the range and see if it fits in between
                        // 2: do not need to check the range, so just add it
                        if (endTime) {
                            endTime = new Date(endTime);
                            let inRange = this.isInTimeRange(requestedDate, endTime, { hour, minute });
                            if (inRange) {
                                let timeslot = new Date(requestedDate.getFullYear(), requestedDate.getUTCMonth(), requestedDate.getUTCDate(), hour, minute);
                                availableTimes.push(timeslot);
                            }
                        }
                        else {
                            let timeslot = new Date(requestedDate.getFullYear(), requestedDate.getUTCMonth(), requestedDate.getUTCDate(), hour, minute);
                            availableTimes.push(timeslot);
                        }
                    }
                }
            }
        }
        return availableTimes;
    }

    isInTimeRange(start, end, time) {
        start = (start instanceof Date) ? start : this.builder.EntityRecognizer.parseTime(start);
        end = (end instanceof Date) ? end : this.builder.EntityRecognizer.parseTime(end);

        let afterReqStart = (time.hour > start.getHours() || (time.hour == start.getHours() && time.minute >= start.getMinutes()));
        let beforeReqEnd = (time.hour < end.getHours() || (time.hour == end.getHours() && time.minute < end.getMinutes()));
        return (afterReqStart && beforeReqEnd);
    }

    getAvailableDays(session, timeRange) {
        if (timeRange) session.userData.requestedDate = this.builder.EntityRecognizer.parseTime(timeRange.start);
        let requestedDate = (session.userData.requestedDate instanceof Date) ? session.userData.requestedDate : new Date(session.userData.requestedDate);
        let sched = schedule.doctorsSchedule[session.userData.doctorType];
        let availableDays = [];
        for (let year in sched) {
            for (let month in sched[year]) {
                for (var day in sched[year][month]) {
                    let schedDay = sched[year][month][day];
                    let schedDateObj = new Date(year, month, day, 0, 0, 0, 0);
                    // if the date in the schedule is after the current date
                    if (new Date(requestedDate).setHours(0, 0, 0, 0) <= schedDateObj) {
                        // if supplied a timeRange
                        if (timeRange) {
                            for (var hour in schedDay) {
                                for (var minute in schedDay[hour]) {
                                    if (schedDay[hour][minute] == 'available') {
                                        // check if this available timeslot fits in requested time range
                                        let inRange = this.isInTimeRange(timeRange.start, timeRange.end, { hour, minute });
                                        if (inRange) {
                                            let availableDay = new Date(year, month, day, hour, minute);
                                            availableDays.push(availableDay);
                                        }
                                    }
                                }
                            }
                        }
                        // if supplied just time (hour and minutes)
                        if (!timeRange && (schedDay[requestedDate.getHours()]) && (schedDay[requestedDate.getHours()][requestedDate.getMinutes()])
                            && (schedDay[requestedDate.getHours()][requestedDate.getMinutes()] == 'available')) {
                            let availableDay = new Date(year, month, day, requestedDate.getHours(), requestedDate.getMinutes());
                            availableDays.push(availableDay);
                        }
                    }
                }
            }
        }
        return availableDays;
    }

    isIncrementOfThirty(time) {
        return (time.getMinutes() == 0 || time.getMinutes() == 30);
    }
}

module.exports = Helpers;
/**
 * Complex Java file demonstrating inheritance and interfaces.
 */
package com.example.complex;

import java.util.List;
import java.util.Map;
import java.io.Serializable;

/**
 * Interface for data processing.
 */
public interface DataProcessor {
    void process(String data);
    String getStatus();
}

/**
 * Base class for all handlers.
 * @param <T> The type of data to handle
 */
public abstract class BaseHandler<T> implements Serializable {
    protected String handlerId;

    public abstract void handle(T data);

    public String getId() {
        return this.handlerId;
    }
}

/**
 * Concrete handler that extends BaseHandler and implements DataProcessor.
 */
public class ConcreteHandler extends BaseHandler<String> implements DataProcessor {
    private int processCount;
    private List<String> processedItems;

    public ConcreteHandler(String id) {
        this.handlerId = id;
        this.processCount = 0;
        this.processedItems = new ArrayList<>();
    }

    @Override
    public void handle(String data) {
        process(data);
    }

    @Override
    public void process(String data) {
        this.processedItems.add(data);
        this.processCount++;
        logProcess(data);
    }

    @Override
    public String getStatus() {
        return "Processed: " + this.processCount;
    }

    private void logProcess(String data) {
        System.out.println("Processing: " + data);
    }

    /**
     * Method with varargs.
     * @param items Variable arguments
     */
    public void processMultiple(String... items) {
        for (String item : items) {
            process(item);
        }
    }
}

/**
 * Enum for processing status.
 */
public enum ProcessingStatus {
    PENDING,
    IN_PROGRESS,
    COMPLETED,
    FAILED
}
